import { supabase } from '../supabase';

export const PUBLIC_STORE_COLUMNS = 'id, store_id, business_name, currency, country, state, city, address, phone, email, logo, subscription_status, data, access_code, qr_code';

export type PublicStoreRecord = {
  id: string;
  store_id?: string | null;
  access_code?: string | null;
  business_name?: string | null;
  currency?: string | null;
  country?: string | null;
  state?: string | null;
  city?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  logo?: string | null;
  subscription_status?: string | null;
  qr_code?: string | null;
  data?: any;
};

/**
 * Turn anything a customer can reasonably paste/scan into the store reference
 * understood by the public resolver. This deliberately does NOT assume every
 * code is a UUID.
 */
export function normalizeStoreReference(value: string): string {
  let raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const candidate = /^https?:\/\//i.test(raw) ? new URL(raw) : null;
    if (candidate) {
      const parts = candidate.pathname.split('/').filter(Boolean);
      if ((parts[0] === 's' || parts[0] === 'store') && parts[1]) raw = decodeURIComponent(parts[1]);
      else {
        const queryStore = candidate.searchParams.get('storeId') || candidate.searchParams.get('store');
        if (queryStore) raw = queryStore;
      }
    }
  } catch {
    // Keep the original text. It might be an access code rather than a URL.
  }

  raw = raw.trim();
  if (/^(?:sf-)?[a-z0-9]{6,12}$/i.test(raw)) return raw.toUpperCase();
  return raw;
}

export function matchesPublicStoreReference(store: PublicStoreRecord | any, value: string): boolean {
  if (!store) return false;
  const key = normalizeStoreReference(value);
  const upper = key.toUpperCase();
  const noSf = upper.replace(/^SF-/, '');
  const candidates = [
    store.id,
    store.store_id,
    store.access_code,
    store.data?.storeId,
    store.data?.accessCode,
    store.data?.profile?.uniqueCode,
  ].filter(Boolean).map((candidate: any) => String(candidate).trim().toUpperCase());

  if (candidates.includes(upper) || candidates.includes(noSf) || candidates.includes(`SF-${noSf}`)) return true;
  return typeof store.qr_code === 'string' && store.qr_code.toUpperCase().includes(upper);
}

/**
 * The one store resolver used by deep links, in-app scanning and manual entry.
 * The RPC is intentionally the primary path because it can safely resolve
 * UUIDs, SF store IDs, 6-character access codes and legacy public aliases
 * without constructing a PostgREST OR that mixes UUID/text types.
 */
export async function resolvePublicStore(value: string): Promise<{ store: PublicStoreRecord | null; error: any }> {
  const key = normalizeStoreReference(value);
  if (!key) return { store: null, error: null };

  try {
    const rpc = await supabase.rpc('get_public_storefront', { p_key: key });
    if (!rpc.error && rpc.data) return { store: rpc.data as PublicStoreRecord, error: null };
    return { store: null, error: rpc.error || null };
  } catch (error) {
    return { store: null, error };
  }
}

export async function listPublicStorefronts(limit = 100, offset = 0, query = ''): Promise<{ stores: PublicStoreRecord[]; error: any }> {
  try {
    const rpc = await supabase.rpc('list_public_storefronts', {
      p_limit: Math.min(Math.max(Math.trunc(limit), 1), 100),
      p_offset: Math.max(Math.trunc(offset), 0),
      p_query: query.trim() || null,
    });
    if (rpc.error) return { stores: [], error: rpc.error };
    return { stores: Array.isArray(rpc.data) ? rpc.data as PublicStoreRecord[] : [], error: null };
  } catch (error) {
    return { stores: [], error };
  }
}
