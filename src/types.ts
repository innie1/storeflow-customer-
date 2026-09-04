/** Shared domain types for the customer app. */

export interface Product {
  id: string;
  store_id: string;
  category_id?: string;
  barcode?: string;
  name: string;
  description?: string;
  brand?: string;
  cost_price?: number;
  selling_price: number;
  wholesale_price?: number;
  retail_price?: number;
  quantity: number;
  unit?: string;
  isService?: boolean;
  turnaround?: string;
  image?: string;
  status?: string;
  category?: string;
}

export interface Store {
  id: string;
  business_name: string;
  phone?: string;
  address?: string;
  logo?: string;
  currency: string;
  subscription_status?: string;
  data?: any;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  price: number;
  subtotal: number;
  product?: Product;
}

export interface Order {
  id: string;
  store_id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  status: string;
  subtotal: number;
  total: number;
  notes?: string;
  created_at: string;
  order_items?: OrderItem[];
}

/**
 * What the customer ordered, kept locally so the tracking screen can show the
 * items and the amount owed. The merchant's copy of the order is the source of
 * truth; this is only for display on this device.
 */
export interface TrackedOrder {
  total: number;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  loyaltyDiscount: number;
  deliveryType: 'pickup' | 'delivery';
  paymentMethod: string;
  items: Array<{ name: string; quantity: number; price: number }>;
}
