/**
 * StoreFlow Customer — URL Router
 *
 * Permanent URL architecture. These paths must NEVER change.
 * Future native app will intercept via Universal Links (iOS) / App Links (Android).
 */

import { supabase } from './supabase';

export interface RouteResult { storeId: string | null; productId: string | null; }
export interface QRData { version: number; uuid: string; token: string; storeId: string; timestamp: number; type: string; payload: any; }

const VISITOR_KEY = 'storeflow_customer_uuid';
const SESSION_KEY = 'storeflow_analytics_session';

function analyticsIdentity() {
  try {
    let visitorId = localStorage.getItem(VISITOR_KEY);
    if (!visitorId) { visitorId = crypto.randomUUID(); localStorage.setItem(VISITOR_KEY, visitorId); }
    let sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) { sessionId = crypto.randomUUID(); sessionStorage.setItem(SESSION_KEY, sessionId); }
    return { visitorId, sessionId };
  } catch { return { visitorId: null, sessionId: null }; }
}

async function logStoreAnalytics(storeId: string, eventType: 'qr_scan' | 'store_code_lookup' | 'store_view', source: string) {
  if (!storeId) return;
  try {
    const { visitorId, sessionId } = analyticsIdentity();
    let customerUuid: string | null = null;
    let isGuest = true;
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      const { data: profile } = await supabase.from('profiles').select('customer_uuid').eq('auth_user_id', session.user.id).maybeSingle();
      customerUuid = profile?.customer_uuid || null;
      isGuest = false;
    } else {
      try { customerUuid = localStorage.getItem(VISITOR_KEY); } catch { /* non-fatal */ }
    }
    let storeUuid = storeId;
    const { data: store } = await supabase.from('stores_public').select('id').or(`store_id.eq.${storeId},access_code.eq.${storeId},id.eq.${storeId}`).maybeSingle();
    if (store?.id) storeUuid = store.id;
    // Analytics must never block routing. The RPC is fire-and-forget from the user's perspective.
    await supabase.rpc('record_store_analytics_event', {
      p_store_id: storeUuid,
      p_event_type: eventType,
      p_visitor_id: visitorId,
      p_customer_uuid: customerUuid,
      p_is_guest: isGuest,
      p_source: source,
      p_metadata: { session_id: sessionId },
    });
  } catch (error) {
    console.debug('[StoreFlow Analytics] non-blocking event failed', error);
  }
}

/** Decode the StoreFlow QR payload without throwing on malformed input. */
export function decodeQRData(encoded: string): QRData | null {
  try {
    if (!encoded || encoded.length > 8192) return null;
    const normalized = decodeURIComponent(encoded).replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const key = 0x5F;
    const decodedBytes = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) decodedBytes[i] = bytes[i] ^ key;
    const jsonStr = new TextDecoder().decode(decodedBytes);
    const parsed = JSON.parse(jsonStr) as Partial<QRData>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.storeId !== 'string' || !parsed.storeId.trim()) return null;
    return parsed as QRData;
  } catch { return null; }
}

function parsePathSegments(pathname: string): RouteResult {
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0];
  if ((root === 's' || root === 'store') && segments[1] && segments[2] === 'p' && segments[3]) {
    const decodedStore = decodeQRData(segments[1]);
    const decodedProduct = decodeQRData(segments[3]);
    return { storeId: decodedStore?.storeId || segments[1], productId: decodedProduct?.payload?.id || decodedProduct?.storeId || segments[3] };
  }
  if ((root === 's' || root === 'store') && segments[1]) {
    const decodedStore = decodeQRData(segments[1]);
    if (decodedStore?.storeId) return { storeId: decodedStore.storeId, productId: decodedStore.type === 'product' && decodedStore.payload?.id ? decodedStore.payload.id : null };
    return { storeId: segments[1], productId: null };
  }
  return { storeId: null, productId: null };
}

export function parseRoute(): RouteResult {
  const pathResult = parsePathSegments(window.location.pathname);
  if (pathResult.storeId) {
    void logStoreAnalytics(pathResult.storeId, 'qr_scan', 'store_url');
    return pathResult;
  }
  const params = new URLSearchParams(window.location.search);
  const qsId = params.get('storeId') || params.get('store');
  if (qsId) {
    const decodedStore = decodeQRData(qsId);
    const storeId = decodedStore?.storeId || qsId;
    void logStoreAnalytics(storeId, 'qr_scan', 'store_query');
    return { storeId, productId: null };
  }
  return { storeId: null, productId: null };
}

export function parseQRCode(raw: string): RouteResult {
  const s = raw.trim();
  if (!s || s.length > 8192) return { storeId: null, productId: null };
  if (s.toUpperCase().startsWith('SF-')) {
    const storeId = s.toUpperCase();
    void logStoreAnalytics(storeId, 'store_code_lookup', 'scanner');
    return { storeId, productId: null };
  }
  const decoded = decodeQRData(s);
  if (decoded?.storeId) {
    void logStoreAnalytics(decoded.storeId, 'qr_scan', 'scanner');
    return { storeId: decoded.storeId, productId: decoded.type === 'product' && decoded.payload?.id ? decoded.payload.id : null };
  }
  try {
    const url = new URL(s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`);
    const result = parsePathSegments(url.pathname);
    if (result.storeId) { void logStoreAnalytics(result.storeId, 'qr_scan', 'scanner'); return result; }
  } catch { /* Not a URL. */ }
  if (!/\s/.test(s)) { void logStoreAnalytics(s, 'store_code_lookup', 'manual'); return { storeId: s, productId: null }; }
  return { storeId: null, productId: null };
}
