/**
 * Per-order access tokens.
 *
 * A guest customer has no Supabase Auth session, so the order-status and
 * cancel RPCs authorise on either the phone number that placed the order or a
 * token handed back at order time. The token is what lets someone track an
 * order on a device whose phone number does not match.
 */

const ORDER_TOKEN_PREFIX = 'storeflow_order_token_';

export function saveOrderAccessToken(orderId: string, token: string) {
  try {
    localStorage.setItem(ORDER_TOKEN_PREFIX + orderId, token);
  } catch (e) {
    // Storage full or unavailable (e.g. private browsing) — non-fatal,
    // the phone-based check still covers this order.
    console.warn('Could not cache order access token locally:', e);
  }
}

export function getOrderAccessToken(orderId: string): string | null {
  try {
    return localStorage.getItem(ORDER_TOKEN_PREFIX + orderId);
  } catch {
    return null;
  }
}

export function getStoredOrderCredentials(): Array<{ order_id: string; access_token: string }> {
  const credentials: Array<{ order_id: string; access_token: string }> = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(ORDER_TOKEN_PREFIX)) continue;
      const orderId = key.slice(ORDER_TOKEN_PREFIX.length);
      const token = localStorage.getItem(key);
      if (orderId && token) credentials.push({ order_id: orderId, access_token: token });
    }
  } catch {
    return [];
  }
  return credentials.slice(0, 50);
}
