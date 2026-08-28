import { supabase } from './supabase';

export const PUBLIC_STORE_COLUMNS = 'id, store_id, business_name, currency, country, state, city, address, phone, email, logo, subscription_status, data, access_code, qr_code';

export function normalizeStoreIdentifier(raw: string): string {
  let value = String(raw || '').trim();
  if (!value) return '';

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const queryId = url.searchParams.get('storeId') || url.searchParams.get('store') || url.searchParams.get('code');
    if (queryId) value = queryId;
    else {
      const parts = url.pathname.split('/').filter(Boolean);
      if ((parts[0] === 's' || parts[0] === 'store') && parts[1]) value = parts[1];
    }
  } catch {}

  try { value = decodeURIComponent(value); } catch {}
  return value.trim();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function resolvePublicStore(raw: string): Promise<{ data: any | null; error: any | null }> {
  const clean = normalizeStoreIdentifier(raw);
  if (!clean) return { data: null, error: null };

  const upper = clean.toUpperCase();
  const access = upper.replace(/^SF-/, '');
  const candidates: Array<[string, string]> = [];

  if (isUuid(clean)) candidates.push(['id', clean]);
  candidates.push(['store_id', upper]);
  if (!upper.startsWith('SF-')) candidates.push(['store_id', `SF-${upper}`]);
  candidates.push(['access_code', access]);

  const seen = new Set<string>();
  let lastError: any = null;
  for (const [column, value] of candidates) {
    const key = `${column}:${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await supabase.from('stores_public').select(PUBLIC_STORE_COLUMNS).eq(column, value).limit(1).maybeSingle();
    if (result.error) {
      lastError = result.error;
      continue;
    }
    if (result.data) return { data: result.data, error: null };
  }

  // Legacy QR payloads may have stored the identifier inside qr_code.
  // This is deliberately last because exact store/access IDs are faster and safer.
  const legacy = await supabase.from('stores_public').select(PUBLIC_STORE_COLUMNS).ilike('qr_code', `%${clean}%`).limit(1);
  if (!legacy.error && legacy.data?.[0]) return { data: legacy.data[0], error: null };
  if (legacy.error) lastError = legacy.error;

  return { data: null, error: lastError };
}
