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
