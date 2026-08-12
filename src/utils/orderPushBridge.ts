import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Notify the merchant after a customer order has been committed.
 *
 * This is deliberately fire-and-forget: the order database transaction is the
 * source of truth and must not be turned into a failed order just because a
 * push service is unavailable. The merchant also has Supabase Realtime and
 * the notifications table as delivery paths.
 */
export async function notifyMerchantOfNewOrder(
  supabase: SupabaseClient,
  orderId: string,
): Promise<void> {
  if (!orderId) return;

  try {
    const { error } = await supabase.functions.invoke('send-order-push', {
      body: {
        order_id: orderId,
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
