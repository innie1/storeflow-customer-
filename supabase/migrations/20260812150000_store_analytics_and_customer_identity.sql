alter table public.orders add column if not exists customer_uuid uuid;
alter table public.orders add column if not exists is_guest boolean not null default true;

create table if not exists public.store_analytics_events (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  event_type text not null check (event_type in ('qr_scan','store_code_lookup','store_view','product_view','cart_started','checkout_started','order_placed','order_completed','order_cancelled')),
  visitor_id uuid,
  customer_uuid uuid,
  is_guest boolean not null default true,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_store_analytics_store_created on public.store_analytics_events(store_id, created_at desc);
create index if not exists idx_store_analytics_store_event on public.store_analytics_events(store_id, event_type, created_at desc);
create index if not exists idx_store_analytics_customer on public.store_analytics_events(store_id, customer_uuid);

alter table public.store_analytics_events enable row level security;
drop policy if exists analytics_insert_public on public.store_analytics_events;
create policy analytics_insert_public on public.store_analytics_events for insert to anon, authenticated
with check (store_id is not null);
drop policy if exists analytics_select_owner on public.store_analytics_events;
create policy analytics_select_owner on public.store_analytics_events for select to authenticated
using (exists (select 1 from public.stores s join public.profiles p on p.id=s.owner_id where s.id=store_analytics_events.store_id and p.auth_user_id=auth.uid()));

create or replace function public.record_store_analytics_event(p_store_id uuid,p_event_type text,p_visitor_id uuid default null,p_customer_uuid uuid default null,p_is_guest boolean default true,p_source text default null,p_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_store_id is null or p_event_type not in ('qr_scan','store_code_lookup','store_view','product_view','cart_started','checkout_started','order_placed','order_completed','order_cancelled') then raise exception 'Invalid analytics event'; end if;
  if p_event_type in ('qr_scan','store_code_lookup') and p_visitor_id is not null then
    select id into v_id from public.store_analytics_events where store_id=p_store_id and event_type=p_event_type and visitor_id=p_visitor_id and created_at > now()-interval '20 seconds' order by created_at desc limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.store_analytics_events(store_id,event_type,visitor_id,customer_uuid,is_guest,source,metadata)
  values(p_store_id,p_event_type,p_visitor_id,p_customer_uuid,coalesce(p_is_guest,true),p_source,coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.record_store_analytics_event(uuid,text,uuid,uuid,boolean,text,jsonb) from public;
grant execute on function public.record_store_analytics_event(uuid,text,uuid,uuid,boolean,text,jsonb) to anon, authenticated;

create or replace function public.place_order_atomic(p_store_id text,p_customer_name text,p_customer_phone text,p_order_number text,p_status text,p_subtotal numeric,p_total numeric,p_notes text,p_items jsonb,p_customer_uuid uuid default null,p_is_guest boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_order_id uuid; v_item jsonb; v_product_id uuid; v_product_store_id uuid; v_product_status text; v_stock numeric; v_current_price numeric; v_qty numeric; v_price numeric; v_item_subtotal numeric; v_expected_subtotal numeric:=0; v_pricing_mode text:='retail'; v_store_id uuid;
begin
  if nullif(trim(p_store_id),'') is null or nullif(trim(p_order_number),'') is null then raise exception 'Missing store or order number'; end if;
  begin v_store_id:=p_store_id::uuid; exception when invalid_text_representation then raise exception 'Invalid store id'; end;
  if nullif(trim(p_customer_name),'') is null then raise exception 'Customer name is required'; end if;
  if nullif(trim(p_customer_phone),'') is null then raise exception 'Customer phone is required'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Order must contain at least one item'; end if;
  if coalesce(p_subtotal,-1)<0 or coalesce(p_total,-1)<0 then raise exception 'Order totals cannot be negative'; end if;
  perform public.check_rate_limit('place_order_atomic',p_customer_phone,10,600);
  select id into v_order_id from public.orders where store_id=v_store_id and order_number=p_order_number limit 1;
  if v_order_id is not null then return v_order_id; end if;
  begin v_pricing_mode:=coalesce(nullif((p_notes::jsonb->>'pricing_mode'),''),'retail'); exception when others then v_pricing_mode:='retail'; end;
  if v_pricing_mode not in ('retail','wholesale') then v_pricing_mode:='retail'; end if;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if nullif(trim(v_item->>'product_id'),'') is null then raise exception 'Order contains an item without a product id'; end if;
    begin v_qty:=(v_item->>'quantity')::numeric; v_price:=(v_item->>'price')::numeric; v_item_subtotal:=(v_item->>'subtotal')::numeric; exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Order contains an invalid item quantity or price'; end;
    if v_qty<=0 or v_price<0 or v_item_subtotal<0 then raise exception 'Order contains an invalid item quantity or price'; end if;
    if abs(v_item_subtotal-(v_qty*v_price))>0.01 then raise exception 'Order item subtotal does not match quantity and price'; end if;
    v_expected_subtotal:=v_expected_subtotal+v_item_subtotal;
    begin v_product_id:=(v_item->>'product_id')::uuid; exception when invalid_text_representation then v_product_id:=null; end;
    if v_product_id is not null then
      select store_id,status,coalesce(quantity,0),selling_price into v_product_store_id,v_product_status,v_stock,v_current_price from public.products where id=v_product_id for update;
      if not found then raise exception 'Product is no longer available'; end if;
      if v_product_store_id is distinct from v_store_id then raise exception 'Product does not belong to this store'; end if;
      if v_product_status is not null and lower(v_product_status) not in ('active','new','popular') then raise exception 'Product is no longer available'; end if;
      if v_stock<v_qty then raise exception 'Not enough stock for product %',v_item->>'product_id'; end if;
      if v_pricing_mode='retail' and abs(coalesce(v_current_price,0)-v_price)>0.01 then raise exception 'Price changed for product %; please refresh your cart',v_item->>'product_id'; end if;
    end if;
  end loop;
  if abs(v_expected_subtotal-p_subtotal)>0.01 then raise exception 'Order subtotal is out of date; please review your cart'; end if;
  insert into public.orders(store_id,customer_name,customer_phone,order_number,status,subtotal,total,notes,status_history,customer_uuid,is_guest)
  values(v_store_id,p_customer_name,p_customer_phone,p_order_number,p_status,p_subtotal,p_total,p_notes,jsonb_build_array(jsonb_build_object('status',p_status,'at',now())),p_customer_uuid,coalesce(p_is_guest,true)) returning id into v_order_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into public.order_items(order_id,product_id,quantity,price,subtotal) values(v_order_id,(v_item->>'product_id')::text,(v_item->>'quantity')::numeric,(v_item->>'price')::numeric,(v_item->>'subtotal')::numeric);
  end loop;
  return v_order_id;
exception when unique_violation then
  select id into v_order_id from public.orders where store_id=v_store_id and order_number=p_order_number limit 1;
  if v_order_id is not null then return v_order_id; end if;
  raise;
end; $$;
