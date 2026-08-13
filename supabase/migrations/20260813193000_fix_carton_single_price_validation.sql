-- Keep server-side order price validation aligned with the customer catalog.
-- Carton/single products can be displayed at singleSellingPrice when
-- isCartonSingleEnabled=true; the old RPC validated sellingPrice instead,
-- causing valid carts to be rejected as "Price changed".
-- Also validate wholesale orders against wholesalePrice when available.

create or replace function public.place_order_atomic(p_store_id text, p_customer_name text, p_customer_phone text, p_order_number text, p_status text, p_subtotal numeric, p_total numeric, p_notes text, p_items jsonb, p_customer_uuid uuid default null, p_is_guest boolean default true)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_product_store_id uuid;
  v_product_status text;
  v_stock numeric;
  v_current_price numeric;
  v_qty numeric;
  v_price numeric;
  v_item_subtotal numeric;
  v_expected_subtotal numeric := 0;
  v_pricing_mode text := 'retail';
  v_store_id uuid;
  v_catalog_item jsonb;
  v_service_item jsonb;
  v_item_id text;
  v_service_index int;
begin
  if nullif(trim(p_store_id), '') is null or nullif(trim(p_order_number), '') is null then raise exception 'Missing store or order number'; end if;
  begin v_store_id := p_store_id::uuid; exception when invalid_text_representation then raise exception 'Invalid store id'; end;
  if nullif(trim(p_customer_name), '') is null then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_phone), '') is null then raise exception 'Customer phone is required'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Order must contain at least one item'; end if;
  if coalesce(p_subtotal, -1) < 0 or coalesce(p_total, -1) < 0 then raise exception 'Order totals cannot be negative'; end if;
  perform public.check_rate_limit('place_order_atomic', p_customer_phone, 10, 600);
  select id into v_order_id from public.orders where store_id = v_store_id and order_number = p_order_number limit 1;
  if v_order_id is not null then return v_order_id; end if;

  begin v_pricing_mode := coalesce(nullif((p_notes::jsonb ->> 'pricing_mode'), ''), 'retail'); exception when others then v_pricing_mode := 'retail'; end;
  if v_pricing_mode not in ('retail', 'wholesale') then v_pricing_mode := 'retail'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_item_id := nullif(trim(v_item->>'product_id'), '');
    if v_item_id is null then raise exception 'Order contains an item without a product id'; end if;
    begin
      v_qty := (v_item->>'quantity')::numeric;
      v_price := (v_item->>'price')::numeric;
      v_item_subtotal := (v_item->>'subtotal')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'Order contains an invalid item quantity or price';
    end;
    if v_qty <= 0 or v_price < 0 or v_item_subtotal < 0 then raise exception 'Order contains an invalid item quantity or price'; end if;
    if abs(v_item_subtotal - (v_qty * v_price)) > 0.01 then raise exception 'Order item subtotal does not match quantity and price'; end if;
    v_expected_subtotal := v_expected_subtotal + v_item_subtotal;
    v_product_id := null;
    begin v_product_id := v_item_id::uuid; exception when invalid_text_representation then v_product_id := null; end;

    if v_product_id is not null then
      select store_id, status, coalesce(quantity, 0), selling_price into v_product_store_id, v_product_status, v_stock, v_current_price from public.products where id = v_product_id for update;
      if found then
        if v_product_store_id is distinct from v_store_id then raise exception 'Product does not belong to this store'; end if;
        if v_product_status is not null and lower(v_product_status) not in ('active', 'new', 'popular') then raise exception 'Product is no longer available'; end if;
        if v_stock < v_qty and coalesce((select is_service from public.products where id = v_product_id), false) = false then raise exception 'Not enough stock for product %', v_item_id; end if;
        if v_pricing_mode = 'retail' and abs(coalesce(v_current_price, 0) - v_price) > 0.01 then raise exception 'Price changed for product %; please refresh your cart', v_item_id; end if;
      else
        select elem into v_catalog_item from public.stores s, lateral jsonb_array_elements(coalesce(s.data->'products', '[]'::jsonb)) elem where s.id = v_store_id and (elem->>'id' = v_item_id or elem->>'productId' = v_item_id) limit 1;
        if v_catalog_item is null then
          select elem into v_service_item from public.stores s, lateral jsonb_array_elements(coalesce(s.data->'businessTemplate'->'offerings', '[]'::jsonb)) elem where s.id = v_store_id and (elem->>'id' = v_item_id) limit 1;
        end if;
        if v_catalog_item is null and v_service_item is null then raise exception 'Product or service is no longer available'; end if;
        if v_catalog_item is not null then
          if coalesce((v_catalog_item->>'discontinued')::boolean, false) then raise exception 'Product is no longer available'; end if;
          if coalesce((v_catalog_item->>'quantity')::numeric, 0) < v_qty and coalesce((v_catalog_item->>'isService')::boolean, false) = false then raise exception 'Not enough stock for product %', v_item_id; end if;
          if v_pricing_mode = 'wholesale' then
            v_current_price := coalesce((v_catalog_item->>'wholesalePrice')::numeric, (v_catalog_item->>'wholesale_price')::numeric, (v_catalog_item->>'sellingPrice')::numeric, (v_catalog_item->>'selling_price')::numeric, 0);
          elsif coalesce((v_catalog_item->>'isCartonSingleEnabled')::boolean, false) then
            v_current_price := coalesce((v_catalog_item->>'singleSellingPrice')::numeric, (v_catalog_item->>'retailPrice')::numeric, (v_catalog_item->>'sellingPrice')::numeric, (v_catalog_item->>'selling_price')::numeric, 0);
          else
            v_current_price := coalesce((v_catalog_item->>'retailPrice')::numeric, (v_catalog_item->>'retail_price')::numeric, (v_catalog_item->>'sellingPrice')::numeric, (v_catalog_item->>'selling_price')::numeric, 0);
          end if;
          if abs(v_current_price - v_price) > 0.01 then raise exception 'Price changed for product %; please refresh your cart', v_item_id; end if;
        end if;
      end if;
    else
      select elem into v_catalog_item from public.stores s, lateral jsonb_array_elements(coalesce(s.data->'products', '[]'::jsonb)) elem where s.id = v_store_id and (elem->>'id' = v_item_id or elem->>'productId' = v_item_id) limit 1;
      if v_catalog_item is null then
        select elem into v_service_item from public.stores s, lateral jsonb_array_elements(coalesce(s.data->'businessTemplate'->'offerings', '[]'::jsonb)) elem where s.id = v_store_id and elem->>'id' = v_item_id limit 1;
        if v_service_item is null and v_item_id ~ '^service-[0-9]+$' then
          v_service_index := substring(v_item_id from 9)::int;
          select elem into v_service_item from public.stores s, lateral jsonb_array_elements(coalesce(s.data->'businessTemplate'->'offerings', '[]'::jsonb)) with ordinality x(elem, ord) where s.id = v_store_id and x.ord = v_service_index + 1 limit 1;
        end if;
      end if;
      if v_catalog_item is null and v_service_item is null then raise exception 'Product or service is no longer available'; end if;
      if v_catalog_item is not null then
        if coalesce((v_catalog_item->>'discontinued')::boolean, false) then raise exception 'Product is no longer available'; end if;
        if coalesce((v_catalog_item->>'quantity')::numeric, 0) < v_qty and coalesce((v_catalog_item->>'isService')::boolean, false) = false then raise exception 'Not enough stock for product %', v_item_id; end if;
        if v_pricing_mode = 'wholesale' then
          v_current_price := coalesce((v_catalog_item->>'wholesalePrice')::numeric, (v_catalog_item->>'wholesale_price')::numeric, (v_catalog_item->>'sellingPrice')::numeric, (v_catalog_item->>'selling_price')::numeric, 0);
        elsif coalesce((v_catalog_item->>'isCartonSingleEnabled')::boolean, false) then
          v_current_price := coalesce((v_catalog_item->>'singleSellingPrice')::numeric, (v_catalog_item->>'retailPrice')::numeric, (v_catalog_item->>'sellingPrice')::numeric, (v_catalog_item->>'selling_price')::numeric, 0);
        else
          v_current_price := coalesce((v_catalog_item->>'retailPrice')::numeric, (v_catalog_item->>'retail_price')::numeric, (v_catalog_item->>'sellingPrice')::numeric, (v_catalog_item->>'selling_price')::numeric, 0);
        end if;
        if abs(v_current_price - v_price) > 0.01 then raise exception 'Price changed for product %; please refresh your cart', v_item_id; end if;
      else
        if coalesce((v_service_item->>'enabled')::boolean, true) = false or coalesce((v_service_item->>'active')::boolean, true) = false or coalesce((v_service_item->>'discontinued')::boolean, false) then raise exception 'Service is no longer available'; end if;
        v_current_price := coalesce((v_service_item->>'price')::numeric, (v_service_item->>'sellingPrice')::numeric, 0);
        if abs(v_current_price - v_price) > 0.01 then raise exception 'Service price changed; please refresh your cart'; end if;
      end if;
    end if;
  end loop;

  if abs(v_expected_subtotal - p_subtotal) > 0.01 then raise exception 'Order subtotal is out of date; please review your cart'; end if;
  insert into public.orders (store_id, customer_name, customer_phone, order_number, status, subtotal, total, notes, status_history, customer_uuid, is_guest)
  values (v_store_id, p_customer_name, p_customer_phone, p_order_number, p_status, p_subtotal, p_total, p_notes, jsonb_build_array(jsonb_build_object('status', p_status, 'at', now())), p_customer_uuid, coalesce(p_is_guest, true)) returning id into v_order_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items (order_id, product_id, quantity, price, subtotal) values (v_order_id, (v_item->>'product_id')::text, (v_item->>'quantity')::numeric, (v_item->>'price')::numeric, (v_item->>'subtotal')::numeric);
  end loop;
  return v_order_id;
exception when unique_violation then
  select id into v_order_id from public.orders where store_id = v_store_id and order_number = p_order_number limit 1;
  if v_order_id is not null then return v_order_id; end if;
  raise;
end;
$$;

revoke all on function public.place_order_atomic(text,text,text,text,text,numeric,numeric,text,jsonb,uuid,boolean) from public;
grant execute on function public.place_order_atomic(text,text,text,text,text,numeric,numeric,text,jsonb,uuid,boolean) to anon, authenticated;
