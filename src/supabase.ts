import { createClient } from '@supabase/supabase-js';
import { notifyMerchantOfNewOrder } from './utils/orderPushBridge';

const SUPABASE_URL = "https://jawfalghkftldvkopuaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cbI7g6UDfa9kVg9iRxBHyQ_kqks36Ooj";
const OFFLINE_ORDER_QUEUE_KEY = 'storeflow_pending_rpc_orders_v2';

type RpcArgs = Parameters<ReturnType<typeof createClient>['rpc']>;
type QueuedOrder = { id: string; args: RpcArgs };

const baseSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

function readQueue(): QueuedOrder[] {
  try {
    const raw = window.localStorage.getItem(OFFLINE_ORDER_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeQueue(queue: QueuedOrder[]) {
  try { window.localStorage.setItem(OFFLINE_ORDER_QUEUE_KEY, JSON.stringify(queue)); } catch {}
}

function looksLikeNetworkFailure(error: unknown): boolean {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return !navigator.onLine || /failed to fetch|network|offline|fetch failed|connection|timeout|timed out/.test(message);
}

async function submitQueuedOrder(item: QueuedOrder): Promise<boolean> {
  try {
    const [fn, args, options] = item.args;
    const result = await baseSupabase.rpc(fn as any, args as any, options as any);
    if (result.error || !result.data) return false;
    await notifyMerchantOfNewOrder(baseSupabase, String(result.data));
    return true;
  } catch { return false; }
}

let syncing = false;
export async function syncPendingOrders(): Promise<void> {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  try {
    const queue = readQueue();
    if (!queue.length) return;
    const remaining: QueuedOrder[] = [];
    for (const item of queue) {
      const ok = await submitQueuedOrder(item);
      if (!ok) remaining.push(item);
      if (!navigator.onLine) {
        remaining.push(...queue.slice(queue.indexOf(item) + 1));
        break;
      }
    }
    writeQueue(remaining);
  } finally { syncing = false; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { void syncPendingOrders(); });
  // Give a freshly opened app a chance to flush orders saved by an earlier session.
  if (navigator.onLine) setTimeout(() => { void syncPendingOrders(); }, 1000);
}

const originalRpc = baseSupabase.rpc.bind(baseSupabase);

/**
 * One order boundary for the whole customer app.
 *
 * Online: normal atomic RPC.
 * Offline/transient network failure: persist the exact atomic RPC arguments,
 * return a local pending ID so checkout can finish, then replay the same RPC
 * automatically when connectivity returns. The database remains authoritative.
 */
export const supabase = new Proxy(baseSupabase, {
  get(target, property, receiver) {
    if (property !== 'rpc') return Reflect.get(target, property, receiver);

    return ((...args: RpcArgs) => {
      const fn = args[0];
      const request = originalRpc(...args);
      return request.then(async (result) => {
        if (fn !== 'place_order_atomic') return result;

        if (!result.error && result.data) {
          void notifyMerchantOfNewOrder(target, String(result.data));
          return result;
        }

        if (looksLikeNetworkFailure(result.error)) {
          const id = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const queue = readQueue();
          queue.push({ id, args });
          writeQueue(queue);
          return { data: id, error: null, count: null, status: 200, statusText: 'offline-queued' } as any;
        }

        return result;
      }).catch((error) => {
        if (fn !== 'place_order_atomic' || !looksLikeNetworkFailure(error)) throw error;
        const id = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const queue = readQueue();
        queue.push({ id, args });
        writeQueue(queue);
        return { data: id, error: null, count: null, status: 200, statusText: 'offline-queued' } as any;
      });
    }) as typeof target.rpc;
  },
});
