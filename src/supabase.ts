import { createClient } from '@supabase/supabase-js';
import { notifyMerchantOfNewOrder } from './utils/orderPushBridge';

const SUPABASE_URL = "https://jawfalghkftldvkopuaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cbI7g6UDfa9kVg9iRxBHyQ_qks36Ooj";

const baseSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});

// After the atomic customer order is committed, notify the merchant through
// the existing push router. Delivery is fire-and-forget so push failure can
// never turn a successful order into a failed checkout.
const originalRpc = baseSupabase.rpc.bind(baseSupabase);

export const supabase = new Proxy(baseSupabase, {
  get(target, property, receiver) {
    if (property !== 'rpc') {
      return Reflect.get(target, property, receiver);
    }

    return ((...args: Parameters<typeof target.rpc>) => {
      const request = originalRpc(...args);
      return request.then((result) => {
        if (args[0] === 'place_order_atomic' && result.data && !result.error) {
          void notifyMerchantOfNewOrder(target, String(result.data));
        }
        return result;
      });
    }) as typeof target.rpc;
  },
});
