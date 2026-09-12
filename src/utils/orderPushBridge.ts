import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Notify the merchant after a customer order has been committed.
 *
 * Guest customers do not have a Supabase Auth session, so the order access
 * token is the authority for this notification request. The Edge Function
 * independently verifies the token against the order before it sends anything.
 *
 * This remains deliberately fire-and-forget: the committed order is the source
 * of truth and must not become a failed checkout because push is unavailable.
 */
export async function notifyMerchantOfNewOrder(
  supabase: SupabaseClient,
  orderId: string,
  accessToken: string,
): Promise<void> {
  if (!orderId || !accessToken) return;

  try {
    const { error } = await supabase.functions.invoke('send-order-push', {
      body: {
        order_id: orderId,
        access_token: accessToken,
        initiated_by: 'customer',
      },
    });

    if (error) {
      console.warn('[StoreFlow] Merchant new-order push failed:', error);
    }
  } catch (error) {
    console.warn('[StoreFlow] Merchant new-order push failed:', error);
  }
}
