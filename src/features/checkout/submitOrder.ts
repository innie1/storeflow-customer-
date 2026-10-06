import { placeOrder, type CheckoutItem } from './checkoutService';

export interface SubmitOrderPayload {
  storeId: string;
  customerName: string;
  customerPhone: string;
  orderNumber: string;
  status: string;
  subtotal: number;
  total: number;
  notes?: string;
  items: CheckoutItem[];
}

/**
 * Single retryable checkout entry point.
 *
 * The UI can call this instead of knowing about Supabase RPC details. The
 * underlying RPC is idempotent, so retrying the same order number is safe.
 * Client-side validation happens in placeOrder(); the database remains the
 * final authority for stock, pricing and transaction integrity.
 */
export async function submitOrderWithRetry(
  payload: SubmitOrderPayload,
  retries = 2,
): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await placeOrder(payload);
      return result.orderId;
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;

      // Short exponential backoff prevents a transient connection failure
      // from immediately hammering the checkout endpoint again.
      const delayMs = 400 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('We could not confirm your order. Please check your orders before trying again.');
}
