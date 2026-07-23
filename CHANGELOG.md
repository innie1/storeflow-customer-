# Changelog

All notable changes to the StoreFlow Customer app are logged here.

## [2026-07-23] v1.0.1 — Fix: customer order cancellation silently failed — 🔴 Critical

- Root cause: `orders` UPDATE RLS policy only allows store members (`is_store_member`) to update rows. Guest customers have no matching Supabase Auth session, so the app's direct `.update()` call was silently blocked by RLS (0 rows affected, no error returned). The UI showed "Cancelled" anyway because the failure was undetectable client-side.
- Fix: added `customer_cancel_order(p_order_id, p_customer_phone)` SQL RPC (SECURITY DEFINER) that verifies the phone number on the order matches the caller, only allows cancelling while status is `Pending`/`Accepted`, and updates the row server-side.
- App: `handleCancelOrder` in `src/App.tsx` now calls this RPC instead of a raw `.update()`, and only shows "Cancelled" after the RPC confirms success. Also guards against cancelling an order whose ID is still a temporary optimistic/offline placeholder.
