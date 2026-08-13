import { createClient } from '@supabase/supabase-js';
import { notifyMerchantOfNewOrder } from './utils/orderPushBridge';

const SUPABASE_URL = "https://jawfalghkftldvkopuaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cbI7g6UDfa9kVg9iRxBHyQ_kqks36Ooj";

const baseSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

type RpcArgs = Parameters<typeof baseSupabase.rpc>;
const originalRpc = baseSupabase.rpc.bind(baseSupabase);

const QUEUE_KEY = 'storeflow:offline-order-queue:v2';
type QueuedRpc = { id: string; args: RpcArgs };

function readQueue(): QueuedRpc[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
}
function writeQueue(queue: QueuedRpc[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch { /* storage unavailable */ }
}
function looksLikeNetworkFailure(error: unknown): boolean {
  if (!error) return false;
  const e = error as { message?: string; name?: string };
  const message = `${e.name || ''} ${e.message || ''}`.toLowerCase();
  return !navigator.onLine || message.includes('network') || message.includes('fetch') || message.includes('failed to fetch') || message.includes('timeout') || message.includes('offline');
}

async function queueOfflineOrder(args: RpcArgs): Promise<any> {
  const id = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const queue = readQueue();
  queue.push({ id, args });
  writeQueue(queue);
  return { data: id, error: null, count: null, status: 200, statusText: 'offline-queued' };
}

export const supabase = new Proxy(baseSupabase, {
  get(target, property, receiver) {
    if (property !== 'rpc') return Reflect.get(target, property, receiver);

    return ((...args: RpcArgs) => {
      const fn = args[0];
      const request = originalRpc(...args);

      return request.then(
        async (result) => {
          if (fn !== 'place_order_atomic') return result;
          if (!result.error && result.data) {
            void notifyMerchantOfNewOrder(target, String(result.data));
          } else if (looksLikeNetworkFailure(result.error)) {
            return queueOfflineOrder(args);
          }
          return result;
        },
        async (error: unknown) => {
          if (fn !== 'place_order_atomic' || !looksLikeNetworkFailure(error)) throw error;
          return queueOfflineOrder(args);
        },
      );
    }) as typeof target.rpc;
  },
});

// Retry queued orders whenever connectivity returns. Each item is removed only
// after the atomic RPC succeeds, so a temporary outage cannot lose an order.
if (typeof window !== 'undefined') {
  window.addEventListener('online', async () => {
    const queue = readQueue();
    if (!queue.length) return;
    const remaining: QueuedRpc[] = [];
    for (const item of queue) {
      try {
        const result = await originalRpc(...item.args);
        if (result.error) {
          remaining.push(item);
        } else if (result.data) {
          void notifyMerchantOfNewOrder(baseSupabase, String(result.data));
        }
      } catch {
        remaining.push(item);
      }
    }
    writeQueue(remaining);
  });
}
