import { createClient } from '@supabase/supabase-js';
import { notifyMerchantOfNewOrder } from './utils/orderPushBridge';

const SUPABASE_URL = "https://jawfalghkftldvkopuaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cbI7g6UDfa9kVg9iRxBHyQ_kqks36Ooj";

const baseSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    // Persist the customer session across reloads/backgrounding.
    persistSession: true,
    autoRefreshToken: true,
  }
});

// Keep the existing app-wide Supabase API intact, but make the one critical
// customer-order boundary reliable: once place_order_atomic has committed an
// order, immediately route a merchant push through the existing Edge Function.
// This fixes service-business orders as well as normal product orders because
// both use the same atomic checkout RPC.
const originalRpc = baseSupabase.rpc.bind(baseSupabase);

export const supabase = new Proxy(baseSupabase, {
  get(target, property, receiver) {
    if (property === 'rpc') {
      return (async (fn: string, args?: Record<string, unknown>, options?: unknown) => {
        const result = await originalRpc(fn as any, args as any, options as any);

        if (fn === 'place_order_atomic' && result.data && !result.error) {
          // Never block or fail the order because push delivery is unavailable.
          void notifyMerchantOfNewOrder(target, String(result.data));
        }

        return result;
      }) as typeof target.rpc;
    }

    return Reflect.get(target, property, receiver);
  },
});
