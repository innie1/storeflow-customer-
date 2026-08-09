export type CartLine = {
  id: string;
  price?: number;
  quantity: number;
  subtotal?: number;
  [key: string]: unknown;
};

export type CartIntegrityResult = {
  valid: boolean;
  subtotal: number;
  errors: string[];
};

/**
 * Validates the local cart before checkout. This is deliberately a client-side
 * guard only; the database RPC remains the source of truth for price/stock.
 */
export function validateCartIntegrity(items: CartLine[]): CartIntegrityResult {
  const errors: string[] = [];
  let subtotal = 0;
  const seen = new Set<string>();

  for (const item of items) {
    const id = String(item.id || '').trim();
    const quantity = Number(item.quantity);
    const price = Number(item.price);

    if (!id) {
      errors.push('A cart item is missing its product ID.');
      continue;
    }
    if (seen.has(id)) {
      errors.push('Your cart contains a duplicate item.');
    }
    seen.add(id);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push('One cart item has an invalid quantity.');
      continue;
    }
    if (!Number.isFinite(price) || price < 0) {
      errors.push('One cart item has an invalid price.');
      continue;
    }

    const lineSubtotal = quantity * price;
    if (item.subtotal != null && Math.abs(Number(item.subtotal) - lineSubtotal) > 0.01) {
      errors.push('One cart item total is out of date.');
    }
    subtotal += lineSubtotal;
  }

  return {
    valid: items.length > 0 && errors.length === 0 && Number.isFinite(subtotal),
    subtotal: Math.round(subtotal * 100) / 100,
    errors: [...new Set(errors)],
  };
}
