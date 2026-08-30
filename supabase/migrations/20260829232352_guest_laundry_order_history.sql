-- Guest laundry intake and private device-scoped order history.
-- Customers do not authenticate; possession of the per-order UUID token is
-- the only way the customer app can refresh an order after creation.

create or replace function public.customer_place_laundry_order(
  p_store_key text,
  p_customer_name text,
  p_customer_phone text,
  p_customer_address text,
  p_service_id text,
  p_garments jsonb,
  p_notes text default '',
  p_fulfillment text default 'pickup'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_store public.stores%rowtype;
  v_key text := trim(coalesce(p_store_key, ''));
  v_upper text;
  v_no_sf text;
  v_store_type text;
  v_pricing jsonb;
  v_garment_types jsonb;
  v_offerings jsonb;
  v_service jsonb;
  v_service_id text := trim(coalesce(p_service_id, ''));
  v_service_name text := 'Laundry';
  v_pricing_mode text := 'quote';
  v_garment jsonb;
  v_name text;
  v_canonical_name text;
  v_quantity integer;
  v_piece_count integer := 0;
  v_unit_price numeric := 0;
  v_line_subtotal numeric := 0;
  v_total numeric := 0;
  v_summary text := '';
  v_lines jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_access_token uuid;
  v_order_number text;
  v_attempt integer;
  v_meta jsonb;
  v_notes_json text;
  v_item_id uuid;
begin
  if v_key = '' then raise exception 'Store is required'; end if;
  if nullif(trim(coalesce(p_customer_name, '')), '') is null then raise exception 'Customer name is required'; end if;
  if nullif(trim(coalesce(p_customer_phone, '')), '') is null
     or length(regexp_replace(p_customer_phone, '[^0-9]', '', 'g')) < 7 then
    raise exception 'Enter a valid phone number';
  end if;
  if nullif(trim(coalesce(p_customer_address, '')), '') is null then raise exception 'Customer address is required'; end if;
  if p_fulfillment not in ('pickup', 'delivery') then raise exception 'Invalid fulfillment option'; end if;
  if jsonb_typeof(p_garments) <> 'array' or jsonb_array_length(p_garments) < 1 or jsonb_array_length(p_garments) > 50 then
    raise exception 'Choose between 1 and 50 clothing types';
  end if;

  v_key := regexp_replace(v_key, '[?#].*$', '');
  v_key := regexp_replace(v_key, '/+$', '');
  if v_key ~* '^https?://' then
    v_key := regexp_replace(v_key, '^https?://[^/]+/(?:s|store)/', '', 'i');
    v_key := split_part(v_key, '/', 1);
  end if;
  v_upper := upper(v_key);
  v_no_sf := regexp_replace(v_upper, '^SF-', '');

  perform public.check_rate_limit(
    'customer_place_laundry_order',
    lower(trim(p_customer_phone)),
    12,
    600
  );

  select s.* into v_store
  from public.stores s
  where s.id::text = v_key
     or upper(coalesce(s.store_id, '')) = v_upper
     or upper(coalesce(s.store_id, '')) = 'SF-' || v_no_sf
     or upper(coalesce(s.access_code, '')) in (v_upper, v_no_sf)
     or upper(coalesce(s.data->>'storeId', '')) = v_upper
     or upper(coalesce(s.data->>'accessCode', '')) in (v_upper, v_no_sf)
  order by case when s.id::text = v_key then 1 when upper(coalesce(s.store_id, '')) = v_upper then 2 else 3 end
  limit 1;

  if v_store.id is null then raise exception 'Store not found'; end if;
  if coalesce(v_store.subscription_status, 'active') <> 'active' then raise exception 'This store is unavailable'; end if;
  v_store_type := public.normalize_business_type(coalesce(v_store.data->>'storeType', v_store.business_type, ''));
  if v_store_type <> 'laundry' then raise exception 'This store is not a laundry business'; end if;
  if coalesce((v_store.data->'marketplaceSettings'->>'onlineOrdersEnabled')::boolean, true) is false
     or coalesce((v_store.data->'marketplaceSettings'->>'temporarilyHidden')::boolean, false) is true then
    raise exception 'This laundry is not accepting online orders';
  end if;

  v_pricing := coalesce(v_store.data->'laundryPricing', v_store.data->'businessTemplate'->'laundryPricing', '{}'::jsonb);
  v_garment_types := coalesce(v_pricing->'garmentTypes', '[]'::jsonb);
  if jsonb_typeof(v_garment_types) <> 'array' or jsonb_array_length(v_garment_types) = 0 then
    raise exception 'This laundry has not published its clothing list';
  end if;

  v_offerings := coalesce(v_store.data->'businessTemplate'->'offerings', '[]'::jsonb);
  if jsonb_typeof(v_offerings) <> 'array' then v_offerings := '[]'::jsonb; end if;

  if v_service_id <> '' then
    select value into v_service
    from jsonb_array_elements(v_offerings)
    where value->>'id' = v_service_id
      and coalesce((value->>'discontinued')::boolean, false) is false
      and coalesce((value->>'enabled')::boolean, true) is true
      and coalesce((value->>'active')::boolean, true) is true
    limit 1;
    if v_service is null then raise exception 'That laundry treatment is no longer available'; end if;
    v_service_name := coalesce(nullif(trim(v_service->>'name'), ''), 'Laundry');
    v_pricing_mode := lower(coalesce(nullif(v_service->>'pricing', ''), 'per_piece'));
  end if;

  for v_garment in select value from jsonb_array_elements(p_garments)
  loop
    v_name := trim(coalesce(v_garment->>'garment_type', ''));
    v_quantity := floor(coalesce(nullif(v_garment->>'quantity', '')::numeric, 0))::integer;
    if v_name = '' or v_quantity < 1 or v_quantity > 200 then raise exception 'Invalid clothing item'; end if;

    select value #>> '{}' into v_canonical_name
    from jsonb_array_elements(v_garment_types)
    where lower(value #>> '{}') = lower(v_name)
    limit 1;
    if v_canonical_name is null then raise exception '% is not in this laundry price list', v_name; end if;

    v_piece_count := v_piece_count + v_quantity;
    if v_piece_count > 500 then raise exception 'A laundry order cannot exceed 500 items'; end if;

    v_unit_price := 0;
    if v_service is not null and v_pricing_mode = 'per_piece' then
      select greatest(0, value::numeric) into v_unit_price
      from jsonb_each_text(coalesce(v_service->'garmentPrices', '{}'::jsonb))
      where lower(key) = lower(v_canonical_name)
        and value ~ '^[0-9]+([.][0-9]+)?$'
      limit 1;

      if v_unit_price is null then
        select greatest(0, value::numeric) into v_unit_price
        from jsonb_each_text(coalesce(v_pricing->'matrix'->v_service_id, '{}'::jsonb))
        where lower(key) = lower(v_canonical_name)
          and value ~ '^[0-9]+([.][0-9]+)?$'
        limit 1;
      end if;

      if v_unit_price is null then
        v_unit_price := case
          when coalesce(v_service->>'price', v_service->>'sellingPrice', '') ~ '^[0-9]+([.][0-9]+)?$'
          then greatest(0, coalesce(v_service->>'price', v_service->>'sellingPrice')::numeric)
          else 0
        end;
      end if;
    end if;

    v_unit_price := coalesce(v_unit_price, 0);
    v_line_subtotal := v_unit_price * v_quantity;
    v_total := v_total + v_line_subtotal;
    v_summary := v_summary || case when v_summary = '' then '' else ', ' end || v_quantity || '× ' || v_canonical_name;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'garment_type', v_canonical_name,
      'quantity', v_quantity,
      'unit_price', v_unit_price,
      'subtotal', v_line_subtotal
    ));
  end loop;

  if v_service is not null and v_pricing_mode = 'fixed' then
    v_total := case
      when coalesce(v_service->>'price', v_service->>'sellingPrice', '') ~ '^[0-9]+([.][0-9]+)?$'
      then greatest(0, coalesce(v_service->>'price', v_service->>'sellingPrice')::numeric)
      else 0
    end;
  elsif v_service is null then
    v_pricing_mode := 'quote';
    v_total := 0;
  end if;

  for v_attempt in 1..30 loop
    v_order_number := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (
      select 1 from public.orders o
      where o.store_id = v_store.id and upper(o.order_number) = v_order_number
    );
  end loop;
  if exists (select 1 from public.orders o where o.store_id = v_store.id and upper(o.order_number) = v_order_number) then
    raise exception 'Could not generate a unique laundry receipt';
  end if;

  v_meta := jsonb_build_object(
    'source', 'customer_storefront',
    'intake_type', 'customer_self_service',
    'service_id', v_service_id,
    'service_name', v_service_name,
    'pricing', v_pricing_mode,
    'garment_count', v_piece_count,
    'garment_summary', v_summary,
    'garment_lines', v_lines,
    'customer_address', trim(p_customer_address),
    'fulfillment', p_fulfillment,
    'instructions', trim(coalesce(p_notes, '')),
    'receipt_number', v_order_number,
    'tag_code', v_order_number
  );
  v_notes_json := jsonb_build_object(
    'store_name', v_store.business_name,
    'payment_method', 'To be confirmed',
    'delivery_type', p_fulfillment,
    'address', trim(p_customer_address),
    'instructions', trim(coalesce(p_notes, '')),
    'items_summary', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', line->>'garment_type',
        'quantity', (line->>'quantity')::integer,
        'price', (line->>'unit_price')::numeric
      )), '[]'::jsonb)
      from jsonb_array_elements(v_lines) line
    ),
    'service_metadata', v_meta
  )::text;

  insert into public.orders (
    store_id, customer_name, customer_phone, order_number, status,
    subtotal, discount, total, notes, business_type, order_kind,
    workflow_stage, service_metadata, is_guest
  ) values (
    v_store.id, trim(p_customer_name), trim(p_customer_phone), v_order_number, 'Pending',
    v_total, 0, v_total, v_notes_json, 'laundry', 'service',
    'received', v_meta, true
  )
  returning id, access_token into v_order_id, v_access_token;

  for v_garment in select value from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items (
      order_id, product_id, offering_id, item_kind, item_name, unit,
      quantity, price, subtotal, options, metadata
    ) values (
      v_order_id,
      'customer-laundry:' || lower(regexp_replace(v_garment->>'garment_type', '[^a-zA-Z0-9]+', '-', 'g')),
      nullif(v_service_id, ''),
      'service',
      v_garment->>'garment_type',
      'pcs',
      (v_garment->>'quantity')::numeric,
      (v_garment->>'unit_price')::numeric,
      (v_garment->>'subtotal')::numeric,
      jsonb_build_object('service_name', v_service_name, 'pricing', v_pricing_mode),
      jsonb_build_object('source', 'customer_storefront', 'garment_price_snapshot', true)
    )
    returning id into v_item_id;

    insert into public.laundry_order_items (
      order_id, order_item_id, store_id, garment_type, tag_code, quantity,
      special_instructions, workflow_stage, metadata
    ) values (
      v_order_id, v_item_id, v_store.id, v_garment->>'garment_type', v_order_number,
      (v_garment->>'quantity')::numeric, nullif(trim(coalesce(p_notes, '')), ''), 'received',
      jsonb_build_object('source', 'customer_storefront', 'service_id', v_service_id, 'service_name', v_service_name)
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'access_token', v_access_token,
    'order_number', v_order_number,
    'status', 'Pending',
    'workflow_stage', 'received',
    'subtotal', v_total,
    'total', v_total,
    'created_at', now(),
    'store_id', v_store.id,
    'store_name', v_store.business_name,
    'customer_name', trim(p_customer_name),
    'customer_phone', trim(p_customer_phone),
    'notes', v_notes_json,
    'business_type', 'laundry',
    'order_kind', 'service',
    'order_items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'item_name', line->>'garment_type',
        'quantity', (line->>'quantity')::numeric,
        'price', (line->>'unit_price')::numeric,
        'subtotal', (line->>'subtotal')::numeric
      )), '[]'::jsonb)
      from jsonb_array_elements(v_lines) line
    )
  );
end;
$function$;

revoke all on function public.customer_place_laundry_order(text,text,text,text,text,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.customer_place_laundry_order(text,text,text,text,text,jsonb,text,text) to anon, authenticated;

create or replace function public.get_customer_orders_by_tokens(p_credentials jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if jsonb_typeof(p_credentials) <> 'array' then raise exception 'Order credentials must be an array'; end if;
  if jsonb_array_length(p_credentials) > 50 then raise exception 'Too many order credentials'; end if;

  perform public.check_rate_limit(
    'get_customer_orders_by_tokens',
    md5(coalesce(p_credentials::text, '')),
    60,
    600
  );

  with valid_credentials as (
    select
      (credential->>'order_id')::uuid as order_id,
      (credential->>'access_token')::uuid as access_token
    from jsonb_array_elements(p_credentials) credential
    where coalesce(credential->>'order_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      and coalesce(credential->>'access_token', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
  select coalesce(jsonb_agg(to_jsonb(result_row) order by result_row.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      o.id,
      o.store_id,
      o.customer_name,
      o.order_number,
      o.status,
      o.subtotal,
      o.discount,
      o.total,
      o.pickup_time,
      o.notes,
      o.status_history,
      o.business_type,
      o.order_kind,
      o.workflow_stage,
      o.scheduled_for,
      o.started_at,
      o.completed_at,
      o.created_at,
      o.updated_at,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', oi.id,
          'product_id', oi.product_id,
          'offering_id', oi.offering_id,
          'item_kind', oi.item_kind,
          'item_name', oi.item_name,
          'unit', oi.unit,
          'quantity', oi.quantity,
          'price', oi.price,
          'subtotal', oi.subtotal,
          'options', oi.options
        ))
        from public.order_items oi
        where oi.order_id = o.id
      ), '[]'::jsonb) as order_items
    from public.orders o
    join valid_credentials credential
      on credential.order_id = o.id
     and credential.access_token = o.access_token
  ) result_row;

  return v_result;
end;
$function$;

revoke all on function public.get_customer_orders_by_tokens(jsonb) from public, anon, authenticated;
grant execute on function public.get_customer_orders_by_tokens(jsonb) to anon, authenticated;

create or replace function public.get_customer_order_status_by_token(
  p_order_id uuid,
  p_access_token uuid
)
returns jsonb
language sql
security definer
set search_path = ''
stable
as $function$
  select jsonb_build_object(
    'status', o.status,
    'workflow_stage', o.workflow_stage,
    'status_history', o.status_history,
    'notes', o.notes,
    'updated_at', o.updated_at
  )
  from public.orders o
  where o.id = p_order_id
    and o.access_token = p_access_token
$function$;

revoke all on function public.get_customer_order_status_by_token(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_customer_order_status_by_token(uuid,uuid) to anon, authenticated;
