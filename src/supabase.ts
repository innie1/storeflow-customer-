import { createClient } from '@supabase/supabase-js';
import { getOrderAccessToken, getStoredOrderCredentials, saveOrderAccessToken } from './lib/orderTokens';

const SUPABASE_URL = "https://jawfalghkftldvkopuaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cbI7g6UDfa9kVg9iRxBHyQ_qks36Ooj";
const baseSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
type RpcArgs = Parameters<typeof baseSupabase.rpc>;
const originalRpc = baseSupabase.rpc.bind(baseSupabase);

function localRpcResult(data: any, error: any = null): Promise<any> {
  return Promise.resolve({
    data,
    error,
    count: null,
    status: error ? 401 : 200,
    statusText: error ? 'missing-order-token' : 'ok',
  });
}

function missingTokenError() {
  return { message: 'This order is not linked to this device. Open it from the device that placed the order.', code: 'ORDER_TOKEN_REQUIRED' };
}

/**
 * Fold a merchant's legacy `data.games` / `data.services` arrays into the
 * canonical `businessTemplate.offerings` list (and into `data.products`) so a
 * service storefront shows its services regardless of which shape the merchant
 * app happened to save them in.
 */
export function normalizeStoreServices(store: any): any {
  if (!store || typeof store !== 'object' || !store.data || typeof store.data !== 'object') return store;
  const data = store.data;
  const template = data.businessTemplate && typeof data.businessTemplate === 'object' ? data.businessTemplate : {};
  const offerings = Array.isArray(template.offerings) ? template.offerings : [];
  const games = Array.isArray(data.games) ? data.games : [];
  const services = Array.isArray(data.services) ? data.services : [];
  const canonical = [...offerings];
  const seen = new Set(canonical.map((o: any) => String(o?.id || o?.name || '').trim().toLowerCase()).filter(Boolean));
  for (const game of games) {
    if (!game || game.enabled === false) continue;
    const id = String(game.id || game.name || '').trim();
    const name = String(game.name || 'Service').trim();
    const key = (id || name).toLowerCase();
    if (seen.has(key) || canonical.some((o: any) => String(o?.name || '').trim().toLowerCase() === name.toLowerCase())) continue;
    canonical.push({ id: id || `legacy-game-${canonical.length}`, name, description: game.description || '', icon: game.icon || '🎮', price: Number(game.price ?? game.sellingPrice ?? game.selling_price ?? 0), sellingPrice: Number(game.price ?? game.sellingPrice ?? game.selling_price ?? 0), enabled: true, active: true, pricing: game.pricing || 'time', unit: game.unit || 'session', unitLabel: game.unitLabel || 'per session', source: 'legacy-games' });
    seen.add(key);
    seen.add(name.toLowerCase());
  }
  for (const service of services) {
    if (!service || service.enabled === false || service.active === false || service.discontinued === true) continue;
    const id = String(service.id || service.serviceId || service.name || '').trim();
    const name = String(service.name || service.serviceName || 'Service').trim();
    const key = (id || name).toLowerCase();
    if (seen.has(key) || canonical.some((o: any) => String(o?.name || '').trim().toLowerCase() === name.toLowerCase())) continue;
    canonical.push({ ...service, id: id || `legacy-service-${canonical.length}`, name, price: Number(service.price ?? service.sellingPrice ?? service.selling_price ?? 0), sellingPrice: Number(service.price ?? service.sellingPrice ?? service.selling_price ?? 0), enabled: true, active: true });
    seen.add(key);
    seen.add(name.toLowerCase());
  }
  if (canonical.length === 0) return store;
  const modes = Array.from(new Set([...(Array.isArray(template.modes) ? template.modes : []), 'services']));
  const existingProducts = Array.isArray(data.products) ? data.products : [];
  const existingIds = new Set(existingProducts.map((p: any) => String(p?.id || p?.productId || '').trim()).filter(Boolean));
  const serviceProducts = canonical
    .filter((o: any) => o && o.enabled !== false && o.active !== false && o.discontinued !== true)
    .map((o: any, index: number) => ({ id: String(o.id || `service-${index}`), name: String(o.name || 'Service'), description: o.description || '', sellingPrice: Number(o.price ?? o.sellingPrice ?? o.selling_price ?? 0), selling_price: Number(o.price ?? o.sellingPrice ?? o.selling_price ?? 0), quantity: 999999, unit: o.unit || (o.pricing === 'time' ? 'session' : 'service'), isService: true, turnaround: o.turnaround || '', category: o.category || 'Services', image: o.image || '', discontinued: false, status: 'active', servicePricing: o.pricing || 'fixed', icon: o.icon || '' }))
    .filter((p: any) => !existingIds.has(String(p.id)));
  return { ...store, data: { ...data, products: [...existingProducts, ...serviceProducts], businessTemplate: { ...template, offerings: canonical, modes } } };
}

function normalizeStoresResult(result: any, table: string): any {
  if (table !== 'stores_public' || !result || result.error || !result.data) return result;
  return { ...result, data: Array.isArray(result.data) ? result.data.map(normalizeStoreServices) : normalizeStoreServices(result.data) };
}

function normalizeRealtimePayload(payload: any): any {
  return payload?.new ? { ...payload, new: normalizeStoreServices(payload.new) } : payload;
}

function wrapQueryBuilder(builder: any, table: string): any {
  if (!builder || typeof builder !== 'object') return builder;
  return new Proxy(builder, {
    get(target, property) {
      if (property === 'then') {
        const then = Reflect.get(target, property, target);
        if (typeof then !== 'function') return then;
        return (onFulfilled?: (value: any) => any, onRejected?: (reason: any) => any) =>
          then.call(target, (result: any) => onFulfilled ? onFulfilled(normalizeStoresResult(result, table)) : result, onRejected);
      }
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args: any[]) => wrapQueryBuilder(value.apply(target, args), table);
    },
  });
}

function wrapChannel(channel: any): any {
  if (!channel || typeof channel !== 'object') return channel;
  return new Proxy(channel, {
    get(target, property, receiver) {
      if (property !== 'on') return Reflect.get(target, property, receiver);
      const originalOn = Reflect.get(target, property, target);
      return (event: any, filter: any, callback: any) => {
        if (typeof callback !== 'function') return originalOn.call(target, event, filter, callback);
        return wrapChannel(originalOn.call(target, event, filter, (payload: any) => callback(normalizeRealtimePayload(payload))));
      };
    },
  });
}

/**
 * Order push delivery is now owned by orders-table triggers. Some older UI
 * paths still invoke `send-order-push` after a successful mutation; swallow
 * those calls locally so the browser is never a push authority and old screens
 * do not show a false error while they are being retired.
 */
function wrapFunctionsClient(functionsClient: any): any {
  if (!functionsClient || typeof functionsClient !== 'object') return functionsClient;
  return new Proxy(functionsClient, {
    get(target, property, receiver) {
      if (property !== 'invoke') return Reflect.get(target, property, receiver);
      const originalInvoke = Reflect.get(target, property, target);
      return (functionName: string, options?: any) => {
        if (functionName === 'send-order-push') {
          return Promise.resolve({ data: { queued_by: 'database_trigger' }, error: null });
        }
        return originalInvoke.call(target, functionName, options);
      };
    },
  });
}

export const supabase = new Proxy(baseSupabase, {
  get(target, property, receiver) {
    if (property === 'from') {
      const originalFrom = Reflect.get(target, property, target) as (table: string) => any;
      return (table: string) => wrapQueryBuilder(originalFrom.call(target, table), table);
    }
    if (property === 'channel') {
      const originalChannel = Reflect.get(target, property, target) as (name: string) => any;
      return (name: string) => wrapChannel(originalChannel.call(target, name));
    }
    if (property === 'functions') {
      return wrapFunctionsClient(Reflect.get(target, property, target));
    }
    if (property !== 'rpc') return Reflect.get(target, property, receiver);

    return ((...args: RpcArgs) => {
      const fn = String(args[0]);
      const params = args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])
        ? args[1] as Record<string, any>
        : {};

      // Keep the existing UI contract while the real database endpoint is
      // server-authoritative. The browser's p_status/p_total are intentionally
      // accepted for compatibility but ignored by place_order_secure.
      if (fn === 'place_order_atomic') {
        const secureParams = {
          ...params,
          p_customer_uuid: params.p_customer_uuid ?? null,
          p_is_guest: params.p_is_guest ?? true,
        };
        return originalRpc('place_order_secure', secureParams).then(async (result: any) => {
          if (result.error || !result.data) return result;
          const payload = result.data as Record<string, any>;
          const orderId = String(payload.order_id || '');
          const token = String(payload.access_token || '');
          if (!orderId || !token) {
            return { ...result, data: null, error: { message: 'Secure checkout did not return order credentials.', code: 'INVALID_ORDER_RESPONSE' } };
          }
          saveOrderAccessToken(orderId, token);
          // The database INSERT trigger dispatches the merchant push.
          // App.tsx expects the historical UUID-only return value.
          return { ...result, data: orderId };
        });
      }

      // Phone numbers are identifiers, not proof of ownership. Existing call
      // sites are transparently redirected to token-scoped RPCs.
      if (fn === 'get_customer_orders') {
        return originalRpc('get_customer_orders_by_tokens', { p_credentials: getStoredOrderCredentials() });
      }

      if (fn === 'get_customer_order_status') {
        const orderId = String(params.p_order_id || '');
        const token = getOrderAccessToken(orderId);
        if (!orderId || !token) return localRpcResult(null, missingTokenError()) as any;
        return originalRpc('get_customer_order_status_by_token', { p_order_id: orderId, p_access_token: token });
      }

      // The token is now returned only once by secure checkout and cached on
      // this device. It can no longer be recovered from an order ID + phone.
      if (fn === 'get_order_access_token') {
        const token = getOrderAccessToken(String(params.p_order_id || ''));
        return localRpcResult(token, token ? null : missingTokenError()) as any;
      }

      if (fn === 'customer_cancel_order' || fn === 'customer_approve_order_changes') {
        const orderId = String(params.p_order_id || '');
        const token = String(params.p_access_token || getOrderAccessToken(orderId) || '');
        if (!orderId || !token) return localRpcResult(null, missingTokenError()) as any;
        return originalRpc(fn, { ...params, p_access_token: token });
      }

      // Loyalty redemption is performed atomically by secure checkout. The
      // legacy post-checkout call now only reads the token-authorised result so
      // it cannot spend somebody else's points by knowing their phone number.
      if (fn === 'redeem_customer_loyalty') {
        const orderId = String(params.p_order_id || '');
        const token = getOrderAccessToken(orderId);
        if (!orderId || !token) return localRpcResult(null, missingTokenError()) as any;
        return originalRpc('get_order_loyalty_redemption', { p_order_id: orderId, p_access_token: token });
      }

      // A rating now needs proof that this device owns a completed order from
      // the store. The typed/customer phone is deliberately ignored.
      if (fn === 'submit_store_rating') {
        return originalRpc('submit_store_rating_verified', {
          p_store_id: params.p_store_id,
          p_credentials: getStoredOrderCredentials(),
          p_rating: params.p_rating,
          p_tags: params.p_tags ?? [],
        });
      }

      return originalRpc(...args);
    }) as typeof target.rpc;
  },
});
