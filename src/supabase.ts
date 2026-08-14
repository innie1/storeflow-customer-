import { createClient } from '@supabase/supabase-js';
import { notifyMerchantOfNewOrder } from './utils/orderPushBridge';

const SUPABASE_URL = "https://jawfalghkftldvkopuaw.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_cbI7g6UDfa9kVg9iRxBHyQ_qks36Ooj";
const baseSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
type RpcArgs = Parameters<typeof baseSupabase.rpc>;
const originalRpc = baseSupabase.rpc.bind(baseSupabase);
const QUEUE_KEY = 'storeflow:offline-order-queue:v2';
type QueuedRpc = { id: string; args: RpcArgs };
function readQueue(): QueuedRpc[] { try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; } }
function writeQueue(queue: QueuedRpc[]) { try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch {} }
function looksLikeNetworkFailure(error: unknown): boolean { if (!error) return false; const e = error as { message?: string; name?: string }; const message = `${e.name || ''} ${e.message || ''}`.toLowerCase(); return !navigator.onLine || message.includes('network') || message.includes('fetch') || message.includes('failed to fetch') || message.includes('timeout') || message.includes('offline'); }
async function queueOfflineOrder(args: RpcArgs): Promise<any> { const id = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; const queue = readQueue(); queue.push({ id, args }); writeQueue(queue); return { data: id, error: null, count: null, status: 200, statusText: 'offline-queued' }; }

function normalizeStoreServices(store: any): any {
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
    const id = String(game.id || game.name || '').trim(); const name = String(game.name || 'Service').trim(); const key = (id || name).toLowerCase();
    if (seen.has(key) || canonical.some((o: any) => String(o?.name || '').trim().toLowerCase() === name.toLowerCase())) continue;
    canonical.push({ id: id || `legacy-game-${canonical.length}`, name, description: game.description || '', icon: game.icon || '🎮', price: Number(game.price ?? game.sellingPrice ?? game.selling_price ?? 0), sellingPrice: Number(game.price ?? game.sellingPrice ?? game.selling_price ?? 0), enabled: true, active: true, pricing: game.pricing || 'time', unit: game.unit || 'session', unitLabel: game.unitLabel || 'per session', source: 'legacy-games' });
    seen.add(key); seen.add(name.toLowerCase());
  }
  for (const service of services) {
    if (!service || service.enabled === false || service.active === false || service.discontinued === true) continue;
    const id = String(service.id || service.serviceId || service.name || '').trim(); const name = String(service.name || service.serviceName || 'Service').trim(); const key = (id || name).toLowerCase();
    if (seen.has(key) || canonical.some((o: any) => String(o?.name || '').trim().toLowerCase() === name.toLowerCase())) continue;
    canonical.push({ ...service, id: id || `legacy-service-${canonical.length}`, name, price: Number(service.price ?? service.sellingPrice ?? service.selling_price ?? 0), sellingPrice: Number(service.price ?? service.sellingPrice ?? service.selling_price ?? 0), enabled: true, active: true });
    seen.add(key); seen.add(name.toLowerCase());
  }
  if (canonical.length === 0) return store;
  const modes = Array.from(new Set([...(Array.isArray(template.modes) ? template.modes : []), 'services']));
  const existingProducts = Array.isArray(data.products) ? data.products : [];
  const existingIds = new Set(existingProducts.map((p: any) => String(p?.id || p?.productId || '').trim()).filter(Boolean));
  const serviceProducts = canonical.filter((o: any) => o && o.enabled !== false && o.active !== false && o.discontinued !== true).map((o: any, index: number) => ({ id: String(o.id || `service-${index}`), name: String(o.name || 'Service'), description: o.description || '', sellingPrice: Number(o.price ?? o.sellingPrice ?? o.selling_price ?? 0), selling_price: Number(o.price ?? o.sellingPrice ?? o.selling_price ?? 0), quantity: 999999, unit: o.unit || (o.pricing === 'time' ? 'session' : 'service'), isService: true, turnaround: o.turnaround || '', category: o.category || 'Services', image: o.image || '', discontinued: false, status: 'active', servicePricing: o.pricing || 'fixed', icon: o.icon || '' })).filter((p: any) => !existingIds.has(String(p.id)));
  return { ...store, data: { ...data, products: [...existingProducts, ...serviceProducts], businessTemplate: { ...template, offerings: canonical, modes } } };
}
function normalizeStoresResult(result: any, table: string): any { if (table !== 'stores_public' || !result || result.error || !result.data) return result; return { ...result, data: Array.isArray(result.data) ? result.data.map(normalizeStoreServices) : normalizeStoreServices(result.data) }; }
function normalizeRealtimePayload(payload: any): any { return payload?.new ? { ...payload, new: normalizeStoreServices(payload.new) } : payload; }
function wrapQueryBuilder(builder: any, table: string): any {
  if (!builder || typeof builder !== 'object') return builder;
  return new Proxy(builder, { get(target, property) {
    if (property === 'then') {
      const then = Reflect.get(target, property, target); if (typeof then !== 'function') return then;
      return (onFulfilled?: (value: any) => any, onRejected?: (reason: any) => any) => then.call(target, (result: any) => onFulfilled ? onFulfilled(normalizeStoresResult(result, table)) : result, onRejected);
    }
    const value = Reflect.get(target, property, target); if (typeof value !== 'function') return value;
    return (...args: any[]) => wrapQueryBuilder(value.apply(target, args), table);
  } });
}
function wrapChannel(channel: any): any {
  if (!channel || typeof channel !== 'object') return channel;
  return new Proxy(channel, { get(target, property, receiver) {
    if (property !== 'on') return Reflect.get(target, property, receiver);
    const originalOn = Reflect.get(target, property, target);
    return (event: any, filter: any, callback: any) => { if (typeof callback !== 'function') return originalOn.call(target, event, filter, callback); return wrapChannel(originalOn.call(target, event, filter, (payload: any) => callback(normalizeRealtimePayload(payload)))); };
  } });
}
export const supabase = new Proxy(baseSupabase, { get(target, property, receiver) {
  if (property === 'from') { const originalFrom = Reflect.get(target, property, target) as (table: string) => any; return (table: string) => wrapQueryBuilder(originalFrom.call(target, table), table); }
  if (property === 'channel') { const originalChannel = Reflect.get(target, property, target) as (name: string) => any; return (name: string) => wrapChannel(originalChannel.call(target, name)); }
  if (property !== 'rpc') return Reflect.get(target, property, receiver);
  return ((...args: RpcArgs) => {
    const fn = args[0]; let rpcArgs = args;
    if (fn === 'place_order_atomic' && args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])) { const params = args[1] as Record<string, unknown>; rpcArgs = [fn, { ...params, p_customer_uuid: params.p_customer_uuid ?? null, p_is_guest: params.p_is_guest ?? true }] as unknown as RpcArgs; }
    const request = originalRpc(...rpcArgs);
    return request.then(async (result) => { if (fn !== 'place_order_atomic') return result; if (!result.error && result.data) { if (typeof result.data === 'string' && !result.data.startsWith('offline-')) void notifyMerchantOfNewOrder(target, String(result.data)); } else if (looksLikeNetworkFailure(result.error)) return queueOfflineOrder(rpcArgs); return result; }, async (error: unknown) => { if (fn !== 'place_order_atomic' || !looksLikeNetworkFailure(error)) throw error; return queueOfflineOrder(rpcArgs); });
  }) as typeof target.rpc;
} });
if (typeof window !== 'undefined') { window.addEventListener('online', async () => { const queue = readQueue(); if (!queue.length) return; const remaining: QueuedRpc[] = []; for (const item of queue) { try { const result = await originalRpc(...item.args); if (result.error) remaining.push(item); else if (result.data) void notifyMerchantOfNewOrder(baseSupabase, String(result.data)); } catch { remaining.push(item); } } writeQueue(remaining); }); }