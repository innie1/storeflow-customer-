import { supabase } from '../../supabase';
import { validateCartIntegrity, type CartIntegrityItem } from '../../utils/cartIntegrity';

export interface CheckoutItem extends CartIntegrityItem {
  productId: string;
}

export interface PlaceOrderInput {
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

export interface PlaceOrderResult {
  orderId: string;
}

/**
 * Client-side checkout guard and API boundary.
 *
 * This intentionally does not treat client values as authoritative. The
 * database RPC remains responsible for the final price, stock, ownership and
 * transaction checks. This service only prevents obviously invalid requests
 * from reaching the network and gives the UI a single place to call checkout.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const validation = validateCartIntegrity(
    input.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.subtotal,
    })),
    input.subtotal,
  );

  if (!validation.valid) {
    throw new Error(validation.message || 'Please review your cart before checking out.');
  }

  if (!input.storeId || !input.customerName.trim() || !input.customerPhone.trim()) {
    throw new Error('Please complete your checkout details.');
  }

  if (!Number.isFinite(input.total) || input.total < input.subtotal) {
    throw new Error('Your checkout total is invalid. Please review your cart.');
  }

  const { data, error } = await supabase.rpc('place_order_atomic', {
    p_store_id: input.storeId,
    p_customer_name: input.customerName.trim(),
    p_customer_phone: input.customerPhone.trim(),
    p_order_number: input.orderNumber,
    p_status: input.status,
    p_subtotal: input.subtotal,
    p_total: input.total,
    p_notes: input.notes || null,
    p_items: input.items.map((item) => ({
      product_id: item.productId,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.subtotal,
    })),
  });

  if (error) throw error;

  if (!data) {
    throw new Error('We could not confirm your order. Please check your orders before trying again.');
  }

  return { orderId: String(data) };
}
