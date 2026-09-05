-- Make the public storefront listing stop shipping merchant profile photos.
--
-- WHY
-- ---
-- The project was suspended for exceed_egress_quota. Measured on production:
-- list_public_storefronts(100,0,null) returned 5,305 kB for 29 stores.
--
-- 5,037 kB of that — 95% — was `data.profile.photo`: two merchants have a
-- base64 data URI saved into their profile JSON, one of them 2.5 MB on its
-- own. Every customer opening the app downloaded both of them, in full, in
-- every directory refresh. Nothing in the customer app reads profile.photo at
-- all, so all of it was waste.
--
-- The listing was built by calling get_public_storefront() once per store,
-- which returns a complete storefront each time: full catalogue, offerings,
-- laundry pricing, cover image, profile photo. That is the right payload for
-- ONE store the customer has opened, and the wrong one for a directory of
-- names and badges.
--
-- This rewrites the listing to build its own light record. Measured on the
-- same data: 240 kB instead of 5,305 kB, a 95% reduction, with the catalogue
-- still included so Quick Order can search across a customer's own stores.
--
-- WHAT IS DELIBERATELY KEPT
-- -------------------------
-- * The same JSON shape and field names, so no client change is required.
-- * `data.products`, with exactly the same sensitive fields stripped as
--   get_public_storefront strips — costPrice, wholesalePrice, priceHistory and
--   friends. Dropping that stripping would leak every merchant's buying price
--   to customers, so it is repeated here rather than assumed.
-- * The same visibility rules: no inactive/cancelled stores, no store that has
--   set temporarilyHidden, and the same name/store_id/access_code search.
--
-- WHAT IS DROPPED FROM THE LISTING ONLY
-- -------------------------------------
-- * data.profile.photo         — never read by the customer app; 95% of the bill
-- * data.marketplaceSettings.coverImage — only read on the single store screen
-- * data.businessTemplate.offerings, data.laundryPricing — only used once a
--   customer opens a specific store
--
-- All of them are still returned in full by get_public_storefront(), which is
-- what runs when a customer actually opens a store. Nothing a customer looks
-- at loses any data.
--
-- NOT CHANGED HERE
-- ----------------
-- Storing images as base64 inside the stores.data JSON is the underlying
-- problem; Supabase Storage with a URL reference is the real fix, and it needs
-- a merchant-app change plus a backfill. This migration stops the bleeding
-- without touching how photos are saved.

create or replace function public.list_public_storefronts(
  p_limit integer default 100,
  p_offset integer default 0,
  p_query text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_result jsonb;
begin
  if v_query is not null and length(v_query) > 120 then
    raise exception 'Search query is too long' using errcode = '22023';
  end if;

  -- One check for the whole listing. Previously this ran once per store,
  -- because the rate limit lived inside get_public_storefront and the listing
  -- called it in a loop — so browsing the directory spent 29 rate-limit writes
  -- to answer one request.
  perform public.check_rate_limit('list_public_storefronts', 'listing', 120, 600);

  select coalesce(jsonb_agg(rec order by business_name, id), '[]'::jsonb)
  into v_result
  from (
    select
      s.id,
      s.business_name,
      jsonb_build_object(
        'id', s.id,
        'store_id', s.store_id,
        'business_name', s.business_name,
        'currency', s.currency,
        'country', s.country,
        'state', s.state,
        'city', s.city,
        'address', s.address,
        'phone', s.phone,
        'email', s.email,
        'logo', s.logo,
        'subscription_status', s.subscription_status,
        'access_code', s.access_code,
        'qr_code', s.qr_code,
        'data', jsonb_build_object(
          'storeName', coalesce(s.data->>'storeName', s.business_name, 'Store'),
          'storeId', coalesce(s.data->>'storeId', s.store_id),
          'accessCode', coalesce(s.data->>'accessCode', s.access_code),
          'storeType', coalesce(s.data->>'storeType', s.data->>'businessType', s.business_type, 'other'),
          'businessType', coalesce(s.data->>'businessType', s.data->>'storeType', s.business_type, 'other'),

          -- Sanitised catalogue: same exclusions as get_public_storefront, so a
          -- merchant's cost and wholesale prices never reach a customer.
          'products', (
            select coalesce(jsonb_agg(
              item - 'costPrice' - 'cost_price' - 'wholesalePrice' - 'wholesale_price'
                   - 'total_profit' - 'totalProfit' - 'priceHistory' - 'initialQuantity'
            ), '[]'::jsonb)
            from jsonb_array_elements(coalesce(s.data->'products', '[]'::jsonb)) item
            where coalesce((item->>'discontinued')::boolean, false) is false
          ),

          -- Contact details only. `photo` is a base64 data URI on some stores
          -- and is what suspended the project; it stays in the single-store
          -- payload, which is where a client could actually use it.
          'profile', jsonb_build_object(
            'phone', coalesce(s.data->'profile'->>'phone', s.phone, ''),
            'email', coalesce(s.data->'profile'->>'email', s.email, ''),
            'location', coalesce(s.data->'profile'->>'location', s.address, ''),
            'logoStyle', s.data->'profile'->>'logoStyle',
            'uniqueCode', s.data->'profile'->>'uniqueCode'
          ),

          -- Everything the directory needs to show open/closed, delivery and
          -- pricing badges — minus coverImage, which only the store screen shows.
          'marketplaceSettings', (
            coalesce(s.data->'marketplaceSettings', '{}'::jsonb) - 'coverImage'
          ),

          -- Enough template to pick the right storefront chrome and labels.
          -- `offerings` is left out: it is only needed once a store is opened.
          'businessTemplate', jsonb_build_object(
            'type', coalesce(s.data->'businessTemplate'->>'type', s.data->>'storeType', s.business_type, 'other'),
            'modes', coalesce(s.data->'businessTemplate'->'modes', '[]'::jsonb),
            'labels', coalesce(s.data->'businessTemplate'->'labels', '{}'::jsonb),
            'customerFeatures', coalesce(s.data->'businessTemplate'->'customerFeatures', '{}'::jsonb),
            'customerExperience', coalesce(s.data->'businessTemplate'->'customerExperience', '{}'::jsonb)
          )
        )
      ) as rec
    from public.stores s
    where lower(coalesce(s.subscription_status, 'active')) not in ('inactive', 'cancelled')
      and lower(coalesce(s.data->'marketplaceSettings'->>'temporarilyHidden', 'false')) <> 'true'
      and (
        v_query is null
        or s.business_name ilike '%' || v_query || '%'
        or s.store_id ilike '%' || v_query || '%'
        or s.access_code ilike '%' || v_query || '%'
      )
    order by s.business_name, s.id
    limit v_limit
    offset v_offset
  ) candidate;

  return v_result;
end;
$function$;

comment on function public.list_public_storefronts(integer, integer, text) is
  'Light public storefront directory. Excludes profile.photo, coverImage, offerings and laundryPricing — use get_public_storefront() for a single store. Measured 240 kB vs 5,305 kB for 29 stores.';
