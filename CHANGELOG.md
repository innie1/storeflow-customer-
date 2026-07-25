# Changelog

All notable changes to the StoreFlow Customer app are logged here.

## [2026-07-23] v1.0.1 — Fix: customer order cancellation silently failed — 🔴 Critical

- Root cause: `orders` UPDATE RLS policy only allows store members (`is_store_member`) to update rows. Guest customers have no matching Supabase Auth session, so the app's direct `.update()` call was silently blocked by RLS (0 rows affected, no error returned). The UI showed "Cancelled" anyway because the failure was undetectable client-side.
- Fix: added `customer_cancel_order(p_order_id, p_customer_phone)` SQL RPC (SECURITY DEFINER) that verifies the phone number on the order matches the caller, only allows cancelling while status is `Pending`/`Accepted`, and updates the row server-side.
- App: `handleCancelOrder` in `src/App.tsx` now calls this RPC instead of a raw `.update()`, and only shows "Cancelled" after the RPC confirms success. Also guards against cancelling an order whose ID is still a temporary optimistic/offline placeholder.

## [2026-07-23] v1.0.2 — Cancel/Tracking UI polish — 🟡 Medium

- Replaced `alert()` popups for cancel errors and the "still syncing" message with an inline banner (same style as the existing `orderSubmitError` banner), so a failed cancel doesn't block the whole screen.
- Cancel confirmation modal now explains what happens next (store is notified, order isn't prepared) and, for non-cash orders, tells the customer to contact the store directly about a refund.
- Added an optional cancellation-reason picker (5 quick-select chips) to the cancel modal. Reason is stored in `orders.notes.customer_cancel_reason` via the `customer_cancel_order` RPC (now accepts an optional `p_reason` param) — gives merchants real data on why orders get cancelled.

## [2026-07-23] Supabase — Removed stores null-owner UPDATE loophole — 🟠 High

- `stores` UPDATE policy previously allowed edits by the real owner **OR by anyone if the store had no owner yet** (`owner_id IS NULL`). That meant any ownerless store — even briefly, during onboarding — could be edited by an unauthenticated stranger.
- Fixed: UPDATE policy now requires `owner_id` to match the caller's profile, full stop. No exception.
- 0 stores were affected at the time of the fix (all 7 had an owner assigned) — this closes a latent hole, not an active leak.
- ⚠️ If merchant onboarding elsewhere (separate merchant-app repo) relies on claiming an ownerless store after the fact, that flow will need a dedicated claim RPC instead — not verified in this session, no access to that repo.

## [2026-07-23] Orders privacy fix — 🔴 Critical

- `orders` table SELECT policy was fully public — any order from any customer at any store (name, phone, address, notes) was readable by anyone with just the app's public API key. Confirmed 46 real order rows were exposed at time of fix.
- Fixed: SELECT now scoped to store staff only (`is_store_member(store_id)`), matching the existing UPDATE policy.
- Added two phone-verified RPCs for guest customers, who have no Supabase Auth session to hang RLS off of:
  - `get_customer_orders(p_customer_phone)` — order history list
  - `get_customer_order_status(p_order_id, p_customer_phone)` — single-order tracking status
- App: `loadOrdersHistory` and the order-tracking screen now call these RPCs instead of reading the table directly.
- Trade-off: guest customers previously got instant order-status pushes via Supabase Realtime. Realtime enforces the same RLS as a normal read, so it silently stopped delivering anything to guests once the table was locked down. Replaced with polling — order history every 30s, tracking screen every 20s — and moved status-change desktop notifications into the poll (diffing old vs. new status) so that feature didn't regress. Merchants are unaffected (they're authenticated, so their Realtime dashboard updates still fire instantly).
- Also fixed `handleApproveChanges` ("Approve Proposal" on a Changes Requested order) — found while doing this pass. It had the exact same bug as the original cancel-order issue (raw customer read/update on `orders`, silently blocked by RLS for guests) and was already broken before today, independent of this fix. Now uses a matching `customer_approve_order_changes` RPC.

## [2026-07-24] v1.0.3 — Home scan CTA redesign + scan perf — 🟢 Low

- Home screen "Your Stores" empty state: removed the black "Scan a Store QR Code" button; the white QR icon tile above it is now the single tap target (bigger, 144x144px, `active-scale` press feedback), with a looping fill/gray animation on the icon so it reads as interactive without a second button underneath.
- Scanner: the per-frame canvas used for pixel analysis and worker decode was full camera resolution (up to 1920x1080) on every tick. Capped it to 900px on the long edge — cuts per-frame CPU cost and the data sent to the scanner worker by roughly 3-4x, with no expected loss in decode reliability at typical scan distances. See coder message for further scan-pipeline observations not yet acted on.

## [2026-07-24] v1.0.4 — Native alert() replaced on reorder + profile page cleanup — 🟠 High

- ⚠️ Reconciliation note: this same set of changes was pushed once already (commit d894a06) but got silently reverted when a later push (1937a51, "v1.0.3") landed on top of it from a base that predated it. Re-applied here directly on top of current `main11` HEAD so nothing gets lost this time — please make sure any local/other branches pull this before pushing again.
- Reorder flow: replaced 3 native browser `alert()` calls (the raw "storeflow-customer.vercel.app says" popup) with an in-app styled bottom sheet (`reorderNotice` state), consistent with the rest of the app's error/warning UI. Covers: store unavailable, some items skipped, nothing available, and reorder failure.
- Found while there: 22 other native `alert()` calls remain elsewhere in the app (signup, OTP, geolocation, rating, link-copy, etc.) — same "says" popup issue, not touched in this pass since it wasn't the ask. Flagging for a future cleanup pass.
- Profile Hub: It'sMe identity card shrunk from a large stats-card (p-5, 56px avatar, 3-stat row) to a single compact row (p-3.5, 40px avatar) — full detail is still one tap away on the It'sMe screen.
- It'sMe full screen: hero card avatar/padding reduced to match (80px → 56px avatar).
- Checkout: "Fill with It'sMe" / "Same as Before" buttons were stacking vertically on mobile (`grid-cols-1 sm:grid-cols-2`, and phones never hit the `sm:` breakpoint) — now always side by side, and both shrunk (py-3.5 → py-2.5, rounded-2xl → rounded-xl).
- Dark mode toggle: replaced the sliding switch with a moon/sun icon button — tapping swaps the icon and the mode together.

## [2026-07-24] v1.0.5 — Dark mode divider lines fixed — 🟢 Low

- Dark mode CSS overrides recolored `border-gray-100`/`border-gray-200` but missed `border-gray-50` (Tailwind's near-white gray) — so any divider using that class stayed bright white against dark cards. Visible as two stark white lines in the Store Info card (Delivery Details / Minimum Order rows), but affects 13 spots app-wide using the same class.
- Fixed in `src/index.css` only — one rule, no component changes needed.

## [2026-07-24] v1.0.6 — Reorder always failed for JSONB-catalog stores — 🟠 High

- Root cause confirmed directly in Supabase: store "Mee" has 115 products in `stores.data.products` (JSONB) and **zero rows** in the relational `products` table. This isn't unique to one store — it's however the merchant app stores a catalog that hasn't been synced to the relational table.
- `handleReorder` re-fetched a store's products by querying the relational `products` table only. For any JSONB-catalog store, that query returns nothing, so every single item shows as "unavailable" — regardless of real stock. Confirmed against real data: order SF-304377's item ("Viva Refill (Big)") has 5 in stock; reorder still reported it unavailable purely because of this.
- Fix: extracted the JSONB-first / relational-fallback product resolution (previously only inline in `loadStoreDetails`) into a shared `resolveStoreProducts()` helper, and pointed `handleReorder` at it instead of a raw relational query. Both call sites now can't drift out of sync again.
- Checked for the same pattern elsewhere: 2 other direct `.from('products')` queries exist (barcode scan lookup, deep-link product-by-id) — both look up a single specific product by its real relational id/barcode, a different use case, not "list this store's catalog." Not touched; flagging as a known limitation — a barcode/deep-link product that only exists in a store's JSONB catalog won't resolve either, same underlying cause, separate feature.
- Also checked whether order placement (`place_order_atomic`) or stock decrement depends on the relational table the same way — it doesn't; it just inserts `order_items` rows with no FK/stock logic, so this fix doesn't touch order placement or stock at all.

## [2026-07-24] v1.0.7 — Backend efficiency + critical exposure fix on `stores` — 🔴 Critical (unrelated, flagged per policy)

- 🔴 NOT FIXED, NEEDS YOUR DECISION: `stores` table has a public RLS SELECT policy (qual = `true`, no restriction) and an `owner_password` column. Checked directly — all 7 stores have a password set, none look hashed (no bcrypt pattern). RLS is row-level only, so this isn't a client-code problem alone — anyone with the public anon key can read it directly via the REST API, with or without this app. I did not touch the RLS policy or password storage — that's authentication/security territory + I can't see how the merchant app logs owners in, so I could lock people out by guessing wrong. Needs a decision from you (and likely: hash the password properly, move the login check into a secured RPC/edge function, and tighten or remove the public SELECT policy on sensitive columns).
- Fixed (safe, within my control): every `select('*')` on `stores` in this app — 4 call sites (`loadStoresData`, two in `loadStoreDetails`, one in `handleReorder`) — was pulling `owner_password` down to the client on every store load. Replaced with an explicit `STORE_PUBLIC_COLUMNS` constant that only selects what the app actually reads (checked every `store.`/`storeData.` property access in the codebase to confirm the list). This also means `loadStoresData`'s `localStorage.setItem('storeflow_cached_all_stores', ...)` no longer writes every merchant's password to every customer's browser storage, which it was doing.
- Efficiency audit (asked for this pass): indexes on `products.store_id`, `orders.store_id`, `order_items.order_id` all already exist — no missing index on the hot paths. Didn't add anything to the schema since that needs your sign-off per your own Section 3 (flagging one optional idea below, not applied). Trimmed one diagnostic `select('*', {count:'exact', head:true})` to `select('id', ...)` for clarity — no functional change, head:true already avoided transferring rows.
- Optional, not applied — composite index `(store_id, status)` on `products` for the relational-table fallback path. Low priority: most of the actual cost in this store's case was architectural (0 relational rows, not a missing index). Say the word if you want this added.
