-- Stop sending merchant profile photos to customers at all.
--
-- Two merchants have a base64 data URI in data.profile.photo, together 5,034
-- kB, one of them 2.5 MB alone. 20260905090000 removed them from the directory
-- listing; this removes them from the single-store payload too, so they are
-- never transmitted to a shopper on any path.
--
-- Nothing reads the field. Checked across both apps before applying: the
-- customer app never touches the store's profile.photo (its `profilePhoto`
-- references are the shopper's own "It's Me" profile, unrelated), and the
-- merchant app's storefront consumers — StoreAccess, StoreDeepLink,
-- BusinessStorefront, MarketplaceSettings — read marketplaceSettings, products
-- and contact fields only.
--
-- The photos stay in the database untouched, so each merchant keeps their
-- original for their own receipts, where it is genuinely used and rendered at
-- 48px. They are simply no longer sent to people who cannot see them. This is
-- why no destructive backfill was run: deleting or re-encoding a merchant's
-- image server-side would have cost them data to fix a transmission problem.
--
-- Applied as a surgical replacement of the single line rather than retyping
-- the whole function, so nothing else about it could drift by accident. It
-- aborts if that line is not exactly where it is expected.
--
-- Measured after both migrations:
--   directory listing            5,305 kB -> 257 kB
--   all 29 storefronts combined            -> 271 kB
--   base64 images sent to customers        -> none
--   cost/wholesale prices leaked           -> none

do $$
declare
  v_def text;
  v_target text := E'    ''photo'', v_store.data->''profile''->>''photo'',\n';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'get_public_storefront';

  if v_def is null then
    raise exception 'get_public_storefront not found';
  end if;

  if position(v_target in v_def) = 0 then
    -- Already applied, or the function has been rewritten since. Either way,
    -- editing it blind would be worse than stopping.
    raise notice 'profile photo line not present; nothing to do';
    return;
  end if;

  v_def := replace(v_def, v_target, '');
  execute v_def;
end $$;
