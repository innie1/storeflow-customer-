/**
 * StoreFlow Customer — URL Router
 *
 * Permanent URL architecture. These paths must NEVER change.
 * Future native app will intercept via Universal Links (iOS) / App Links (Android).
 *
 * Supported patterns:
 *   /s/{storeId}                → Store home
 *   /s/{storeId}/p/{productId} → Product deep-link inside store
 *   /store/{storeId}            → Legacy redirect → /s/{storeId}
 *   /?storeId={id}              → Query param fallback
 */

export interface RouteResult {
  storeId: string | null;
  productId: string | null;
}

export interface QRData {
  version: number;
  uuid: string;
  token: string;
  storeId: string;
  timestamp: number;
  type: string;
  payload: any;
}

/** Decode the StoreFlow QR payload without throwing on malformed input. */
export function decodeQRData(encoded: string): QRData | null {
  try {
    if (!encoded || encoded.length > 8192) return null;

    // QR payloads can arrive URL-encoded and/or as base64url. Normalize both
    // forms before decoding so scanner/browser differences don't break links.
    const normalized = decodeURIComponent(encoded)
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));

    const key = 0x5F;
    const decodedBytes = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) decodedBytes[i] = bytes[i] ^ key;

    const jsonStr = new TextDecoder().decode(decodedBytes);
    const parsed = JSON.parse(jsonStr) as Partial<QRData>;

    if (!parsed || typeof parsed !== 'object' || typeof parsed.storeId !== 'string' || !parsed.storeId.trim()) {
      return null;
    }

    return parsed as QRData;
  } catch {
    return null;
  }
}

function parsePathSegments(pathname: string): RouteResult {
  const segments = pathname.split('/').filter(Boolean);
  const root = segments[0];

  if ((root === 's' || root === 'store') && segments[1] && segments[2] === 'p' && segments[3]) {
    const decodedStore = decodeQRData(segments[1]);
    const decodedProduct = decodeQRData(segments[3]);
    return {
      storeId: decodedStore?.storeId || segments[1],
      productId: decodedProduct?.payload?.id || decodedProduct?.storeId || segments[3],
    };
  }

  if ((root === 's' || root === 'store') && segments[1]) {
    const decodedStore = decodeQRData(segments[1]);
    if (decodedStore?.storeId) {
      return {
        storeId: decodedStore.storeId,
        productId: decodedStore.type === 'product' && decodedStore.payload?.id ? decodedStore.payload.id : null,
      };
    }
    return { storeId: segments[1], productId: null };
  }

  return { storeId: null, productId: null };
}

export function parseRoute(): RouteResult {
  const pathResult = parsePathSegments(window.location.pathname);
  if (pathResult.storeId) return pathResult;

  const params = new URLSearchParams(window.location.search);
  const qsId = params.get('storeId') || params.get('store');
  if (qsId) {
    const decodedStore = decodeQRData(qsId);
    return { storeId: decodedStore?.storeId || qsId, productId: null };
  }

  return { storeId: null, productId: null };
}

/**
 * Parse a scanned QR code string and return routing info.
 * Handles full URLs, secure StoreFlow payloads, and bare store IDs.
 */
export function parseQRCode(raw: string): RouteResult {
  const s = raw.trim();
  if (!s || s.length > 8192) return { storeId: null, productId: null };

  if (s.toUpperCase().startsWith('SF-')) {
    return { storeId: s.toUpperCase(), productId: null };
  }

  const decoded = decodeQRData(s);
  if (decoded?.storeId) {
    return {
      storeId: decoded.storeId,
      productId: decoded.type === 'product' && decoded.payload?.id ? decoded.payload.id : null,
    };
  }

  try {
    const url = new URL(s.startsWith('http://') || s.startsWith('https://') ? s : `https://${s}`);
    const result = parsePathSegments(url.pathname);
    if (result.storeId) return result;
  } catch {
    // Not a URL; continue to bare-ID handling below.
  }

  if (!/\s/.test(s)) return { storeId: s, productId: null };
  return { storeId: null, productId: null };
}
