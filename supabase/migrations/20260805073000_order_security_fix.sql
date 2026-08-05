-- ============================================================================
-- Already applied live to project jawfalghkftldvkopuaw via Supabase connector
-- on 2026-08-05. Included here for your records / to replicate on any other
-- environment (staging, local dev, etc).
-- ============================================================================

-- 1. Rate limiting infrastructure (generic, reusable for any RPC)
CREATE TABLE IF NOT EXISTS public.rpc_rate_limits (
  scope text NOT NULL,
  key text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (scope, key)
);
ALTER TABLE public.rpc_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rpc_rate_limits FROM anon, authenticated;

-- check_rate_limit(), get_order_access_token(), customer_cancel_order(),
-- customer_approve_order_changes(), get_customer_orders(),
-- get_customer_order_status(), get_order_by_number(),
-- get_customer_loyalty_balance(), redeem_customer_loyalty(),
-- place_order_atomic() were all updated in place on the live database.
--
-- Full function bodies are in Supabase Studio -> Database -> Functions,
-- or ask Claude to pull the current definitions again with:
--   pg_get_functiondef() against pg_proc for the function names above.
