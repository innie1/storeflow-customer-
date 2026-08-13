-- Make store branding available consistently to the customer app.
-- The merchant app stores built-in logo choices (e.g. minimalist/modern)
-- in stores.logo rather than an image URL. The Home screen expects a URL,
-- while StoreBrandMark can render a generated brand mark. Return a real
-- image URL when one exists; otherwise return a safe generated SVG data URL.

create or replace view public.stores_public as
select
  s.id,
  s.store_id,
  s.business_name,
  s.currency,
  s.country,
  s.state,
  s.city,
  s.address,
  s.phone,
  s.email,
  case
    when coalesce(s.logo,'') ~* '^https?://' then s.logo
    when coalesce(s.data->'profile'->>'logo','') ~* '^https?://' then s.data->'profile'->>'logo'
    when coalesce(s.data->>'logo','') ~* '^https?://' then s.data->>'logo'
    when coalesce(s.data->'marketplaceSettings'->>'logo','') ~* '^https?://' then s.data->'marketplaceSettings'->>'logo'
    else 'data:image/svg+xml;base64,' || encode(convert_to(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 180"><rect width="240" height="180" rx="28" fill="#18191b"/><circle cx="120" cy="65" r="42" fill="none" stroke="#FFD23F" stroke-width="4"/><path d="M96 57h48l-5 31h-38zM96 57l24-25 24 25" fill="none" stroke="#FFD23F" stroke-width="4"/><text x="120" y="139" text-anchor="middle" fill="#F3F4F6" font-family="Arial,sans-serif" font-size="16" font-weight="800">' || replace(replace(replace(coalesce(s.business_name,'Store'),'&','&amp;'),'<','&lt;'),'>','&gt;') || '</text></svg>',
      'UTF8'
    ),'base64')
  end as logo,
  s.subscription_status,
  s.access_code,
  s.qr_code,
  case
    when (s.data ? 'products'::text) then jsonb_set(s.data, '{products}'::text[], coalesce((select jsonb_agg((((((elem.value - 'costPrice'::text) - 'cost_price'::text) - 'wholesalePrice'::text) - 'wholesale_price'::text) - 'total_profit'::text)) from jsonb_array_elements((s.data -> 'products'::text)) elem(value)), '[]'::jsonb))
    else s.data
  end as data
from public.stores s;
