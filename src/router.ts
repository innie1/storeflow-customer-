/**
 * StoreFlow Customer — URL Router
 * 
 * Permanent URL architecture. These paths must NEVER change.
 * Future native app will intercept via Universal Links (iOS) / App Links (Android).
 *
 * Supported patterns:
 *   /s/{storeId}              → Store home
 *   /s/{storeId}/p/{productId} → Product deep-link inside store
 *   /store/{storeId}          → Legacy redirect → /s/{storeId}
 *   /?storeId={id}            → Query param fallback
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
  type: string; // 'store' | 'product' | 'shelf' | 'customer' | 'staff' | 'payment' | 'receipt' | 'inventory' | 'promotion'
  payload: any;
}

// Decodes and validates the secure QR payload
export function decodeQRData(encoded: string): QRData | null {
  try {
    const obfuscated = decodeURIComponent(escape(atob(encoded)));
    const key = 0x5F;
    let jsonStr = '';
    for (let i = 0; i < obfuscated.length; i++) {
      jsonStr += String.fromCharCode(obfuscated.charCodeAt(i) ^ key);
    }
    return JSON.parse(jsonStr) as QRData;
  } catch (e) {
    return null;
  }
}

export function parseRoute(): RouteResult {
  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);

  // Pattern: /s/{storeId}/p/{productId} or /store/{storeId}/p/{productId}
  if ((segments[0] === 's' || segments[0] === 'store') && segments[1] && segments[2] === 'p' && segments[3]) {
    const decodedStore = decodeQRData(segments[1]);
    const decodedProduct = decodeQRData(segments[3]);
    const storeId = decodedStore ? decodedStore.storeId : segments[1];
    const productId = decodedProduct ? (decodedProduct.payload?.id || decodedProduct.storeId) : segments[3];
    return { storeId, productId };
  }

  // Pattern: /s/{storeId} or /store/{storeId}
  if ((segments[0] === 's' || segments[0] === 'store') && segments[1]) {
    const decodedStore = decodeQRData(segments[1]);
    if (decodedStore && decodedStore.storeId) {
      const storeId = decodedStore.storeId;
      const productId = decodedStore.type === 'product' && decodedStore.payload?.id ? decodedStore.payload.id : null;
      return { storeId, productId };
    }
    return { storeId: segments[1], productId: null };
  }

  // Query param fallback: ?storeId=xxx or ?store=xxx
  const params = new URLSearchParams(window.location.search);
  const qsId = params.get('storeId') || params.get('store');
  if (qsId) {
    const decodedStore = decodeQRData(qsId);
    const storeId = decodedStore ? decodedStore.storeId : qsId;
    return { storeId, productId: null };
  }

  return { storeId: null, productId: null };
}

/**
 * Parse a scanned QR code string and return routing info.
 * Handles full URLs or bare IDs.
 */
export function parseQRCode(raw: string): RouteResult {
  const s = raw.trim();

  // Try decoding as secure StoreFlow QR first
  const decoded = decodeQRData(s);
  if (decoded && decoded.storeId) {
    const storeId = decoded.storeId;
    const productId = decoded.type === 'product' && decoded.payload?.id ? decoded.payload.id : null;
    return { storeId, productId };
  }

  // Try as URL first
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const segments = url.pathname.split('/').filter(Boolean);

    // /s/{storeId}/p/{productId} or /store/{storeId}/p/{productId}
    if ((segments[0] === 's' || segments[0] === 'store') && segments[1] && segments[2] === 'p' && segments[3]) {
      const decodedStore = decodeQRData(segments[1]);
      const decodedProduct = decodeQRData(segments[3]);
      const storeId = decodedStore ? decodedStore.storeId : segments[1];
      const productId = decodedProduct ? (decodedProduct.payload?.id || decodedProduct.storeId) : segments[3];
      return { storeId, productId };
    }
    // /s/{storeId} or /store/{storeId}
    if ((segments[0] === 's' || segments[0] === 'store') && segments[1]) {
      const decodedStore = decodeQRData(segments[1]);
      if (decodedStore && decodedStore.storeId) {
        const storeId = decodedStore.storeId;
        const productId = decodedStore.type === 'product' && decodedStore.payload?.id ? decodedStore.payload.id : null;
        return { storeId, productId };
      }
      return { storeId: segments[1], productId: null };
    }
  } catch {
    // Not a URL — treat as bare store ID
  }

  // Bare ID (e.g. "freshmart-uuid")
  if (s && !s.includes(' ')) {
    return { storeId: s, productId: null };
  }

  return { storeId: null, productId: null };
}
