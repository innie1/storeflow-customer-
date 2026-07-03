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

export function parseRoute(): RouteResult {
  const path = window.location.pathname;
  const segments = path.split('/').filter(Boolean);

  // Pattern: /s/{storeId}/p/{productId}
  if (segments[0] === 's' && segments[1] && segments[2] === 'p' && segments[3]) {
    return { storeId: segments[1], productId: segments[3] };
  }

  // Pattern: /s/{storeId}
  if (segments[0] === 's' && segments[1]) {
    return { storeId: segments[1], productId: null };
  }

  // Legacy: /store/{storeId} — redirect to canonical /s/{storeId}
  if (segments[0] === 'store' && segments[1]) {
    const id = segments[1];
    window.history.replaceState({}, '', `/s/${id}`);
    return { storeId: id, productId: null };
  }

  // Query param fallback: ?storeId=xxx or ?store=xxx
  const params = new URLSearchParams(window.location.search);
  const qsId = params.get('storeId') || params.get('store');
  if (qsId) {
    window.history.replaceState({}, '', `/s/${qsId}`);
    return { storeId: qsId, productId: null };
  }

  return { storeId: null, productId: null };
}

/**
 * Parse a scanned QR code string and return routing info.
 * Handles full URLs or bare IDs.
 */
export function parseQRCode(raw: string): RouteResult {
  const s = raw.trim();

  // Try as URL first
  try {
    const url = new URL(s.startsWith('http') ? s : `https://${s}`);
    const segments = url.pathname.split('/').filter(Boolean);

    // /s/{storeId}/p/{productId}
    if (segments[0] === 's' && segments[1] && segments[2] === 'p' && segments[3]) {
      return { storeId: segments[1], productId: segments[3] };
    }
    // /s/{storeId}
    if (segments[0] === 's' && segments[1]) {
      return { storeId: segments[1], productId: null };
    }
    // Legacy /store/{storeId}
    if (segments[0] === 'store' && segments[1]) {
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
