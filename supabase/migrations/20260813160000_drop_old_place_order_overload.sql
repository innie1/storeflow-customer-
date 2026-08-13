-- Migration: drop_old_place_order_overload
-- Purpose: Remove the old 9-argument place_order_atomic overload that was
-- created by the 20260712140000_relax_notifications_rls migration. The newer
-- 11-argument version (from 20260812150000) includes proper validation
-- (stock checks, price checks, rate limiting, idempotency). Having both
-- overloads causes PostgREST "function is not unique" errors when the
-- client doesn't supply exactly the right parameter set, which silently
-- breaks order placement for customers.

DROP FUNCTION IF EXISTS public.place_order_atomic(text, text, text, text, text, numeric, numeric, text, jsonb);
