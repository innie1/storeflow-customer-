-- Additive guest-security rollout.
-- These endpoints are installed before the customer bundle switches to them.
-- Legacy phone/order-code endpoints remain callable until the follow-up lockdown.

create table if not exists public.customer_order_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, endpoint)
);

create index if not exists customer_order_push_subscriptions_order_id_idx
  on public.customer_order_push_subscriptions(order_id);

alter table public.customer_order_push_subscriptions enable row level security;
revoke all on table public.customer_order_push_subscriptions from public, anon, authenticated;
grant all on table public.customer_order_push_subscriptions to service_role;

-- Keep PostgREST clients out of this table completely. Guest access is only
-- through the token-validating RPC below; service_role bypasses RLS for sends.
drop policy if exists "No direct guest push subscription access" on public.customer_order_push_subscriptions;
create policy "No direct guest push subscription access"
on public.customer_order_push_subscriptions
for all
to anon, authenticated
using (false)
with check (false);

create or replace function public.upsert_customer_order_push_subscription(
  p_order_id uuid,
  p_access_token uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_order_id is null or p_access_token is null then
    raise exception 'Order token is required' using errcode = '42501';
  end if;
  if nullif(trim(coalesce(p_endpoint, '')), '') is null
     or nullif(trim(coalesce(p_p256dh, '')), '') is null
     or nullif(trim(coalesce(p_auth, '')), '') is null then
    raise exception 'Push subscription is incomplete';
  end if;

  perform public.check_rate_limit('upsert_customer_order_push_subscription', p_order_id::text, 20, 600);

  if not exists (
    select 1
    from public.orders o
    where o.id = p_order_id
      and o.access_token = p_access_token
  ) then
    raise exception 'Not authorized for this order' using errcode = '42501';
  end if;

  insert into public.customer_order_push_subscriptions(order_id, endpoint, p256dh, auth, updated_at)
  values (p_order_id, trim(p_endpoint), trim(p_p256dh), trim(p_auth), now())
  on conflict (order_id, endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        updated_at = now();

  return true;
end;
$$;

revoke all on function public.upsert_customer_order_push_subscription(uuid,uuid,text,text,text) from public;
grant execute on function public.upsert_customer_order_push_subscription(uuid,uuid,text,text,text) to anon, authenticated;

-- Cross-device guest tracking deliberately uses two customer-known values and
-- returns status-only information. It never returns notes, PII, or access_token,
-- so it cannot be upgraded into cancel/approve authority.
create or replace function public.get_guest_order_by_code(
  p_store_id uuid,
  p_order_number text,
  p_customer_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phone text;
  v_order record;
begin
  v_phone := regexp_replace(coalesce(p_customer_phone, ''), '[^0-9]', '', 'g');
  if length(v_phone) < 10 then
    raise exception 'A valid phone number is required';
  end if;
  v_phone := right(v_phone, 10);

  if nullif(trim(coalesce(p_order_number, '')), '') is null then
    raise exception 'Order code is required';
  end if;

  perform public.check_rate_limit(
    'get_guest_order_by_code',
    p_store_id::text || ':' || upper(trim(p_order_number)) || ':' || v_phone,
    12,
    600
  );

  select o.id, o.store_id, o.order_number, o.status, o.status_history, o.created_at, o.updated_at
    into v_order
  from public.orders o
  where o.store_id = p_store_id
    and upper(trim(coalesce(o.order_number, ''))) = upper(trim(p_order_number))
    and right(regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g'), 10) = v_phone
  order by o.created_at desc
  limit 1;

  if not found then return null; end if;

  return jsonb_build_object(
    'id', v_order.id,
    'store_id', v_order.store_id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'status_history', coalesce(v_order.status_history, '[]'::jsonb),
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'guest_read_only', true
  );
end;
$$;

revoke all on function public.get_guest_order_by_code(uuid,text,text) from public;
grant execute on function public.get_guest_order_by_code(uuid,text,text) to anon, authenticated;

-- A rating is now proof-of-purchase based. The browser supplies locally held
-- order credentials; the database chooses a completed order and derives the
-- customer identity from it instead of accepting a caller-supplied phone.
create or replace function public.submit_store_rating_verified(
  p_store_id text,
  p_credentials jsonb,
  p_rating numeric,
  p_tags text[] default '{}'::text[]
)
returns table(new_rating numeric, new_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
  v_allowed_tags text[] := array['Fast', 'Friendly', 'Affordable', 'Reliable'];
  v_clean_tags text[];
  v_avg numeric;
  v_count integer;
  v_tag_counts jsonb;
begin
  if p_rating < 1 or p_rating > 5 then
    raise exception 'rating must be between 1 and 5';
  end if;
  if p_credentials is null or jsonb_typeof(p_credentials) <> 'array' then
    raise exception 'Completed order proof is required' using errcode = '42501';
  end if;

  select o.id, o.store_id, o.customer_phone, o.status
    into v_order
  from public.orders o
  join lateral jsonb_array_elements(p_credentials) credential on true
  where o.id::text = credential->>'order_id'
    and o.access_token::text = credential->>'access_token'
    and o.store_id::text = p_store_id
    and lower(coalesce(o.status, '')) = 'completed'
  order by o.updated_at desc nulls last, o.created_at desc
  limit 1;

  if not found then
    raise exception 'A completed order from this store is required to rate it' using errcode = '42501';
  end if;

  perform public.check_rate_limit('submit_store_rating_verified', v_order.id::text, 10, 600);

  select coalesce(array_agg(distinct t), '{}') into v_clean_tags
  from unnest(coalesce(p_tags, '{}')) t
  where t = any(v_allowed_tags);

  insert into public.store_ratings (store_id, customer_phone, rating, tags, updated_at)
  values (p_store_id, v_order.customer_phone, p_rating, v_clean_tags, now())
  on conflict (store_id, customer_phone) do update
    set rating = excluded.rating,
        tags = excluded.tags,
        updated_at = now();

  select round(avg(rating)::numeric, 2), count(*)
    into v_avg, v_count
  from public.store_ratings
  where store_id = p_store_id;

  select coalesce(jsonb_object_agg(tag, cnt), '{}'::jsonb) into v_tag_counts
  from (
    select unnest(tags) as tag, count(*) as cnt
    from public.store_ratings
    where store_id = p_store_id
    group by tag
  ) t;

  update public.stores
  set data = jsonb_set(
    jsonb_set(
      jsonb_set(
        coalesce(data, '{}'::jsonb),
        '{marketplaceSettings,rating}',
        to_jsonb(v_avg),
        true
      ),
      '{marketplaceSettings,reviewsCount}',
      to_jsonb(v_count),
      true
    ),
    '{marketplaceSettings,tagCounts}',
    v_tag_counts,
    true
  )
  where id::text = p_store_id;

  return query select v_avg, v_count;
end;
$$;

revoke all on function public.submit_store_rating_verified(text,jsonb,numeric,text[]) from public;
grant execute on function public.submit_store_rating_verified(text,jsonb,numeric,text[]) to anon, authenticated;

-- Keep public storefront funnel analytics, but stop callers from inventing a
-- customer identity or fabricating order lifecycle events. Signed-in identity
-- is derived from auth.uid(); guest identity fields are always null/guest.
create or replace function public.record_store_analytics_event(
  p_store_id uuid,
  p_event_type text,
  p_visitor_id uuid default null,
  p_customer_uuid uuid default null,
  p_is_guest boolean default true,
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_customer_uuid uuid := null;
  v_is_guest boolean := true;
  v_metadata jsonb := '{}'::jsonb;
  v_source text := null;
begin
  if p_store_id is null
     or p_event_type not in ('qr_scan','store_code_lookup','store_view','product_view','cart_started','checkout_started') then
    raise exception 'Invalid public analytics event';
  end if;

  if not exists (select 1 from public.stores s where s.id = p_store_id) then
    raise exception 'Store not found';
  end if;

  if auth.uid() is not null then
    select p.customer_uuid into v_customer_uuid
    from public.profiles p
    where p.auth_user_id = auth.uid()
    limit 1;
    v_is_guest := false;
  end if;

  if jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object'
     and octet_length(coalesce(p_metadata, '{}'::jsonb)::text) <= 4096 then
    v_metadata := coalesce(p_metadata, '{}'::jsonb)
      - 'customer_phone'
      - 'phone'
      - 'email'
      - 'access_token'
      - 'customer_uuid';
  end if;
  v_source := left(nullif(trim(coalesce(p_source, '')), ''), 64);

  perform public.check_rate_limit(
    'record_store_analytics_event',
    p_store_id::text || ':' || p_event_type || ':' || coalesce(p_visitor_id::text, 'guest'),
    120,
    60
  );

  if p_event_type in ('qr_scan','store_code_lookup') and p_visitor_id is not null then
    select id into v_id
    from public.store_analytics_events
    where store_id = p_store_id
      and event_type = p_event_type
      and visitor_id = p_visitor_id
      and created_at > now() - interval '20 seconds'
    order by created_at desc
    limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  insert into public.store_analytics_events(
    store_id, event_type, visitor_id, customer_uuid, is_guest, source, metadata
  ) values (
    p_store_id, p_event_type, p_visitor_id, v_customer_uuid, v_is_guest, v_source, v_metadata
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_store_analytics_event(uuid,text,uuid,uuid,boolean,text,jsonb) from public;
grant execute on function public.record_store_analytics_event(uuid,text,uuid,uuid,boolean,text,jsonb) to anon, authenticated;
