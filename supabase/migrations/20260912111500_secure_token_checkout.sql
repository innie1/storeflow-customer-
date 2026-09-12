-- StoreFlow customer-order security hardening.
--
-- Goals:
--   * phone numbers are identifiers, never proof of order ownership
--   * checkout status and money are server-authoritative
--   * loyalty redemption happens in the same transaction as checkout
--   * customers cannot bypass checkout with raw orders/order_items INSERTs

create or replace function public.place_order_secure(
  p_store_id text,
  p_customer_name text,
  p_customer_phone text,
  p_order_number text,
  p_status text,
  p_subtotal numeric,
  p_total numeric,
  p_notes text,
  p_items jsonb,
  p_customer_uuid uuid default null,
  p_is_guest boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store_id uuid;
  v_store_data jsonb;
  v_market jsonb;
  v_loyalty jsonb;
  v_notes jsonb;
  v_subtotal numeric;
  v_online_discount numeric := 0;
  v_delivery_fee numeric := 0;
  v_loyalty_discount numeric := 0;
  v_total numeric := 0;
  v_minimum_order numeric := 0;
  v_free_delivery_threshold numeric := 0;
  v_reward_value numeric := 0;
  v_reward_type text := 'none';
  v_delivery_type text := 'pickup';
  v_order_id uuid;
  v_access_token uuid;
  v_requested_loyalty boolean := false;
  v_earn_rate numeric := 1;
  v_redeem_threshold integer := 100;
  v_redeem_value numeric := 500;
  v_completed_total numeric := 0;
  v_earned integer := 0;
  v_redeemed integer := 0;
  v_available_points integer := 0;
  v_points_redeemed integer := 0;
begin
  begin
    v_store_id := p_store_id::uuid;
  exception when others then
    raise exception 'Invalid store id';
  end;

  if nullif(trim(coalesce(p_customer_name, '')), '') is null then
    raise exception 'Customer name is required';
  end if;
  if nullif(trim(coalesce(p_customer_phone, '')), '') is null then
    raise exception 'Customer phone is required';
  end if;
  if p_subtotal is null or p_subtotal < 0 then
    raise exception 'Invalid subtotal';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item';
  end if;

  select coalesce(data, '{}'::jsonb)
    into v_store_data
  from public.stores
  where id = v_store_id
    and coalesce(subscription_status, 'active') = 'active';

  if not found then
    raise exception 'Store is unavailable';
  end if;

  v_market := coalesce(v_store_data->'marketplaceSettings', '{}'::jsonb);
  if coalesce((v_market->>'onlineOrdersEnabled')::boolean, true) = false then
    raise exception 'Online ordering is currently disabled for this store';
  end if;
  if coalesce((v_market->>'temporarilyHidden')::boolean, false) = true then
    raise exception 'This store is temporarily unavailable';
  end if;

  begin
    v_notes := coalesce(nullif(trim(coalesce(p_notes, '')), '')::jsonb, '{}'::jsonb);
  exception when others then
    v_notes := jsonb_build_object('instructions', coalesce(p_notes, ''));
  end;

  v_subtotal := round(p_subtotal, 2);
  v_delivery_type := case when lower(coalesce(v_notes->>'delivery_type', 'pickup')) = 'delivery' then 'delivery' else 'pickup' end;

  -- Automatic online-order reward. The browser cannot choose the amount.
  v_reward_type := lower(coalesce(v_market->>'onlineOrderRewardType', 'none'));
  if coalesce(v_market->>'onlineOrderRewardValue', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
    v_reward_value := greatest(0, (v_market->>'onlineOrderRewardValue')::numeric);
  end if;

  if v_reward_type = 'percentage' then
    v_online_discount := round(v_subtotal * least(v_reward_value, 100) / 100, 2);
  elsif v_reward_type = 'flat' then
    v_online_discount := least(v_reward_value, v_subtotal);
  elsif coalesce(v_market->>'onlineDiscount', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
    v_online_discount := round(v_subtotal * least(greatest((v_market->>'onlineDiscount')::numeric, 0), 100) / 100, 2);
  end if;

  -- Delivery fee and free-delivery threshold are also owned by store settings.
  if coalesce(v_market->>'freeDeliveryThreshold', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
    v_free_delivery_threshold := greatest(0, (v_market->>'freeDeliveryThreshold')::numeric);
  elsif lower(coalesce(v_market->>'deliveryRewardType', '')) = 'free'
        and coalesce(v_market->>'deliveryMinSpend', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
    v_free_delivery_threshold := greatest(0, (v_market->>'deliveryMinSpend')::numeric);
  end if;

  if v_delivery_type = 'delivery' then
    if coalesce(v_market->>'deliveryFee', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
      v_delivery_fee := greatest(0, (v_market->>'deliveryFee')::numeric);
    end if;
    if v_free_delivery_threshold > 0 and v_subtotal >= v_free_delivery_threshold then
      v_delivery_fee := 0;
    end if;
  end if;

  if coalesce(v_market->>'deliveryMinOrder', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
    v_minimum_order := greatest(0, (v_market->>'deliveryMinOrder')::numeric);
  elsif coalesce(v_market->>'minimumOrder', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
    v_minimum_order := greatest(0, (v_market->>'minimumOrder')::numeric);
  end if;
  if v_minimum_order > 0 and v_subtotal < v_minimum_order then
    raise exception 'Minimum order is %', v_minimum_order;
  end if;

  -- Loyalty amount from the browser is treated only as a yes/no request.
  -- Eligibility and value are recomputed here, under a per-customer lock.
  v_requested_loyalty := coalesce(v_notes->>'loyalty_discount', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$'
                         and (v_notes->>'loyalty_discount')::numeric > 0;
  if v_requested_loyalty then
    perform pg_advisory_xact_lock(hashtext(v_store_id::text || ':' || p_customer_phone));
    v_loyalty := coalesce(v_store_data->'loyaltySettings', '{}'::jsonb);
    if coalesce((v_loyalty->>'enabled')::boolean, false) then
      if coalesce(v_loyalty->>'earnPerHundred', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
        v_earn_rate := greatest(0, (v_loyalty->>'earnPerHundred')::numeric);
      end if;
      if coalesce(v_loyalty->>'redeemThreshold', '') ~ '^[0-9]+$' then
        v_redeem_threshold := greatest(1, (v_loyalty->>'redeemThreshold')::integer);
      end if;
      if coalesce(v_loyalty->>'redeemValueNaira', '') ~ '^[-+]?[0-9]+([.][0-9]+)?$' then
        v_redeem_value := greatest(0, (v_loyalty->>'redeemValueNaira')::numeric);
      end if;

      select coalesce(sum(total), 0)
        into v_completed_total
      from public.orders
      where store_id = v_store_id
        and customer_phone = p_customer_phone
        and status = 'Completed';

      v_earned := floor((v_completed_total / 100) * v_earn_rate);
      select coalesce(sum(points_redeemed), 0)
        into v_redeemed
      from public.loyalty_redemptions
      where store_id = v_store_id
        and customer_phone = p_customer_phone;
      v_available_points := greatest(0, v_earned - v_redeemed);

      if v_available_points >= v_redeem_threshold then
        v_loyalty_discount := least(v_redeem_value, greatest(0, v_subtotal - v_online_discount + v_delivery_fee));
        v_points_redeemed := v_redeem_threshold;
      end if;
    end if;
  end if;

  v_total := round(greatest(0, v_subtotal - v_online_discount + v_delivery_fee - v_loyalty_discount), 2);

  -- Overwrite money fields in notes with the verified values. This keeps order
  -- history display consistent with the amount actually stored by the server.
  v_notes := v_notes || jsonb_build_object(
    'online_discount', v_online_discount,
    'delivery_fee', v_delivery_fee,
    'loyalty_discount', v_loyalty_discount,
    'server_pricing', true
  );

  -- Reuse the mature catalog/stock/item validation in place_order_atomic, but
  -- supply only server-owned status and final total. Its subtotal and item-price
  -- validation means a forged p_subtotal/p_items payload still fails atomically.
  v_order_id := public.place_order_atomic(
    p_store_id,
    p_customer_name,
    p_customer_phone,
    p_order_number,
    'Pending',
    v_subtotal,
    v_total,
    v_notes::text,
    p_items,
    p_customer_uuid,
    p_is_guest
  );

  update public.orders
     set discount = round(v_online_discount + v_loyalty_discount, 2)
   where id = v_order_id;

  if v_points_redeemed > 0 and v_loyalty_discount > 0 then
    insert into public.loyalty_redemptions(store_id, customer_phone, points_redeemed, value_naira, order_id)
    values (v_store_id, p_customer_phone, v_points_redeemed, v_loyalty_discount, v_order_id);
  end if;

  select access_token into v_access_token from public.orders where id = v_order_id;
  if v_access_token is null then
    raise exception 'Secure checkout could not create an order token';
  end if;

  return jsonb_build_object(
    'order_id', v_order_id,
    'access_token', v_access_token,
    'status', 'Pending',
    'subtotal', v_subtotal,
    'discount', round(v_online_discount + v_loyalty_discount, 2),
    'delivery_fee', v_delivery_fee,
    'total', v_total
  );
end;
$$;

revoke all on function public.place_order_secure(text,text,text,text,text,numeric,numeric,text,jsonb,uuid,boolean) from public;
grant execute on function public.place_order_secure(text,text,text,text,text,numeric,numeric,text,jsonb,uuid,boolean) to anon, authenticated;

-- Tokens are mandatory for cancellation and approval. The phone parameter is
-- retained only for backwards-compatible call signatures; it is not authority.
create or replace function public.customer_cancel_order(
  p_order_id uuid,
  p_customer_phone text,
  p_reason text default null,
  p_access_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_notes jsonb;
begin
  perform public.check_rate_limit('customer_cancel_order', p_order_id::text, 10, 600);
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if nullif(trim(coalesce(p_access_token, '')), '') is null
     or v_order.access_token::text is distinct from p_access_token then
    raise exception 'Not authorized to cancel this order';
  end if;
  if v_order.status not in ('Pending', 'Accepted') then
    raise exception 'Order can no longer be cancelled (current status: %)', v_order.status;
  end if;
  begin
    v_notes := coalesce(v_order.notes::jsonb, '{}'::jsonb);
  exception when others then
    v_notes := jsonb_build_object('instructions', v_order.notes);
  end;
  v_notes := v_notes || jsonb_build_object('customer_cancelled', true);
  if p_reason is not null and length(trim(p_reason)) > 0 then
    v_notes := v_notes || jsonb_build_object('customer_cancel_reason', p_reason);
  end if;
  update public.orders
     set status = 'Cancelled', notes = v_notes::text, updated_at = now()
   where id = p_order_id;
  return jsonb_build_object('success', true, 'status', 'Cancelled');
end;
$$;

create or replace function public.customer_approve_order_changes(
  p_order_id uuid,
  p_customer_phone text,
  p_access_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_notes jsonb;
begin
  perform public.check_rate_limit('customer_approve_order_changes', p_order_id::text, 10, 600);
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'Order not found'; end if;
  if nullif(trim(coalesce(p_access_token, '')), '') is null
     or v_order.access_token::text is distinct from p_access_token then
    raise exception 'Not authorized to modify this order';
  end if;
  begin
    v_notes := coalesce(v_order.notes::jsonb, '{}'::jsonb);
  exception when others then
    v_notes := jsonb_build_object('instructions', v_order.notes);
  end;
  v_notes := v_notes || jsonb_build_object('customer_approved_changes', true);
  update public.orders set notes = v_notes::text, updated_at = now() where id = p_order_id;
  return jsonb_build_object('success', true, 'change_request_message', v_notes->>'change_request_message');
end;
$$;

-- The legacy UI used to call redeem_customer_loyalty after checkout. Secure
-- checkout already performs the redemption, so expose a token-scoped readback.
create or replace function public.get_order_loyalty_redemption(p_order_id uuid, p_access_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_redemption record;
  v_balance jsonb;
begin
  select id, store_id, customer_phone, access_token
    into v_order
  from public.orders
  where id = p_order_id and access_token = p_access_token;
  if not found then raise exception 'Not authorized to view this order'; end if;

  select * into v_redemption
  from public.loyalty_redemptions
  where order_id = p_order_id
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'remainingPoints', null);
  end if;

  v_balance := public.get_customer_loyalty_balance(v_order.store_id, v_order.customer_phone);
  return jsonb_build_object(
    'success', true,
    'valueNaira', v_redemption.value_naira,
    'pointsRedeemed', v_redemption.points_redeemed,
    'remainingPoints', (v_balance->>'points')::integer
  );
end;
$$;

revoke all on function public.get_order_loyalty_redemption(uuid,uuid) from public;
grant execute on function public.get_order_loyalty_redemption(uuid,uuid) to anon, authenticated;

-- Remove phone-only/bypass APIs. Token-scoped replacements remain callable.
revoke execute on function public.get_customer_orders(text) from public, anon, authenticated;
revoke execute on function public.get_customer_order_status(uuid,text) from public, anon, authenticated;
revoke execute on function public.get_order_access_token(uuid,text) from public, anon, authenticated;
revoke execute on function public.redeem_customer_loyalty(uuid,text,uuid) from public, anon, authenticated;
revoke execute on function public.place_order_atomic(text,text,text,text,text,numeric,numeric,text,jsonb,uuid,boolean) from public, anon, authenticated;

grant execute on function public.customer_cancel_order(uuid,text,text,text) to anon, authenticated;
grant execute on function public.customer_approve_order_changes(uuid,text,text) to anon, authenticated;
grant execute on function public.get_customer_orders_by_tokens(jsonb) to anon, authenticated;
grant execute on function public.get_customer_order_status_by_token(uuid,uuid) to anon, authenticated;

-- Customers must use secure checkout. Authenticated store members keep their
-- dedicated policies for merchant-created orders/order items.
drop policy if exists "Customer orders INSERT" on public.orders;
drop policy if exists "Customer order items INSERT" on public.order_items;
revoke insert on public.orders from anon;
revoke insert on public.order_items from anon;
