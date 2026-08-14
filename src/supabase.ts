import { createClient } from '@supabase/supabase-js';
import { notifyMerchantOfNewOrder } from './utils/orderPushBridge';

const SUPABASE_URL = "https://jawfalghkftldvkopuaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cbI7g6UDfa9kVg9iRxBHyQ_qks36Ooj";

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

// The customer UI reads service businesses through stores_public. Normalize the
// merchant-side service configuration here as a final client-side guard so the
// UI does not depend on one particular database-view version. This is read-only:
// it never writes to Manchant or changes the merchant's stored configuration.
const SERVICE_TYPES = new Set([
  'laundry', 'barber', 'salon', 'tailoring', 'repair', 'printing',
  'cyber_cafe', 'car_wash', 'photography', 'cleaning', 'spa',
  'games', 'gaming', 'restaurant'
]);

function normalizeStoreServices(store: any): any {
  if (!store || typeof store !== 'object' || !store.data || typeof store.data !== 'object') return store;

  const data = store.data;
  const template = data.businessTemplate && typeof data.businessTemplate === 'object'
    ? data.businessTemplate
    : {};
  const type = String(template.type || data.storeType || store.storeType || store.business_type || '').toLowerCase();
  const modes = Array.isArray(template.modes) ? template.modes : [];
  const serviceBusiness = SERVICE_TYPES.has(type) || modes.includes('services');
  if (!serviceBusiness) return store;

  const existing = Array.isArray(template.offerings) ? [...template.offerings] : [];
  const seen = new Set(existing.map((o: any) => String(o?.id || o?.name || '').trim().toLowerCase()).filter(Boolean));

  // Gaming is stored by Manchant in data.games. Only enabled games are customer-visible.
  const games = Array.isArray(data.games) ? data.games : [];
  for (const game of games) {
    if (!game || game.enabled === false) continue;
    const id = String(game.id || game.name || '').trim();
    const name = String(game.name || 'Service').trim();
    const key = (id || name).toLowerCase();
    if (seen.has(key) || existing.some((o: any) => String(o?.name || '').trim().toLowerCase() === name.toLowerCase())) continue;
    existing.push({
      id: id || `game-${existing.length}`,
      name,
      icon: game.icon || '🎮',
      price: Number(game.price ?? game.sellingPrice ?? game.selling_price ?? 0),
      enabled: true,
      active: true,
      pricing: 'time',
      mode: 'sessions',
    });
    seen.add(key);
    seen.add(name.toLowerCase());
  }

  // Some service configurations use a direct data.services array. Normalize it
  // too, while preserving the merchant's enabled/active flags.
  const services = Array.isArray(data.services) ? data.services : [];
  for (const service of services) {
    if (!service || service.enabled === false || service.active === false || service.discontinued === true) continue;
    const id = String(service.id || service.serviceId || service.name || '').trim();
    const name = String(service.name || service.serviceName || 'Service').trim();
    const key = (id || name).toLowerCase();
    if (seen.has(key) || existing.some((o: any) => String(o?.name || '').trim().toLowerCase() === name.toLowerCase())) continue;
    existing.push({
      id: id || `service-${existing.length}`,
      name,
      description: service.description || '',
      icon: service.icon || 'design_services',
      price: Number(service.price ?? service.sellingPrice ?? service.selling_price ?? 0),
      enabled: true,
      active: true,
      pricing: service.pricing || 'fixed',
      mode: service.mode || 'services',
      turnaround: service.turnaround || '',
    });
    seen.add(key);
    seen.add(name.toLowerCase());
  }

  return {
    ...store,
    data: {
      ...data,
      businessTemplate: {
        ...template,
        offerings: existing,
      },
    },
  };
}

function normalizeStoresResult(result: any, table: string): any {
  if (table !== 'stores_public' || !result || result.error || !result.data) return result;
  return {
    ...result,
    data: Array.isArray(result.data)
      ? result.data.map(normalizeStoreServices)
      : normalizeStoreServices(result.data),
  };
}

// Wrap only stores_public query builders. This preserves the existing Supabase
// API while normalizing the final response after maybeSingle(), single(), or a
// normal array query resolves. No DOM patching or global observers are involved.
function wrapQueryBuilder(builder: any, table: string): any {
  if (!builder || typeof builder !== 'object') return builder;
  return new Proxy(builder, {
    get(target, property, receiver) {
      if (property === 'then') {
        const then = Reflect.get(target, property, target);
        if (typeof then !== 'function') return then;
        return (onFulfilled?: (value: any) => any, onRejected?: (reason: any) => any) =>
          then.call(target,
            (result: any) => onFulfilled ? onFulfilled(normalizeStoresResult(result, table)) : result,
            onRejected,
          );
      }
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: any[]) => wrapQueryBuilder(value.apply(target, args), table);
    },
  });
}

export const supabase = new Proxy(baseSupabase, {
  get(target, property, receiver) {
    if (property === 'from') {
      const originalFrom = Reflect.get(target, property, target) as (table: string) => any;
      return (table: string) => wrapQueryBuilder(originalFrom.call(target, table), table);
    }
    if (property !== 'rpc') return Reflect.get(target, property, receiver);

    return ((...args: RpcArgs) => {
      const fn = args[0];
      let rpcArgs = args;

      // There are two overloaded place_order_atomic functions in the database:
      // the original 9-argument version and the newer 11-argument version with
      // defaults. Supabase/PostgREST cannot choose between them when only the
      // first 9 named parameters are supplied, so an otherwise valid online
      // order fails with "function ... is not unique". Always select the
      // explicit 11-argument overload. Null customer_uuid is valid for guests.
      if (fn === 'place_order_atomic' && args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])) {
        const params = args[1] as Record<string, unknown>;
        rpcArgs = [fn, {
          ...params,
          p_customer_uuid: params.p_customer_uuid ?? null,
          p_is_guest: params.p_is_guest ?? true,
        }] as unknown as RpcArgs;
      }

      const request = originalRpc(...rpcArgs);

      return request.then(
        async (result) => {
          if (fn !== 'place_order_atomic') return result;
          if (!result.error && result.data) {
            if (typeof result.data === 'string' && !result.data.startsWith('offline-')) {
              void notifyMerchantOfNewOrder(target, String(result.data));
            }
          } else if (looksLikeNetworkFailure(result.error)) {
            return queueOfflineOrder(rpcArgs);
          }
          return result;
        },
        async (error: unknown) => {
          if (fn !== 'place_order_atomic' || !looksLikeNetworkFailure(error)) throw error;
          return queueOfflineOrder(rpcArgs);
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