/**
 * Order pricing, derived from the merchant's own marketplace settings.
 *
 * This lives on its own because the numbers a customer is *shown* on the store
 * page and the numbers they are *charged* at checkout used to be computed in
 * three different places, and they disagreed. The store page advertised
 * `marketplaceSettings.deliveryFee` (falling back to a made-up ₦1,500) and a
 * free-delivery threshold, while the cart and submitOrder each independently
 * hard-coded "₦500, free over ₦5,000" and ignored the merchant entirely. A
 * store charging ₦1,200 delivery billed ₦500; a store offering free delivery
 * over ₦8,000 gave it away at ₦5,000; an advertised online discount was never
 * applied at all; and a minimum order was displayed but never enforced.
 *
 * Everything that touches an order total now goes through this one function.
 */

export interface MarketplaceSettings {
  deliveryFee?: unknown;
  freeDeliveryThreshold?: unknown;
  onlineDiscount?: unknown;
  /** What the merchant app writes. */
  deliveryMinOrder?: unknown;
  /** Older name for the same thing. */
  minimumOrder?: unknown;
}

export interface OrderPricing {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  loyaltyDiscount: number;
  minimumOrder: number;
  belowMinimum: boolean;
  total: number;
}

function toPositiveNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toNonNegativeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Rounds to whole minor units so a percentage can never introduce fractions of a kobo. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeOrderPricing(
  subtotal: number,
  settings: MarketplaceSettings | null | undefined,
  options: { deliveryType: 'pickup' | 'delivery'; loyaltyDiscount?: number } = { deliveryType: 'pickup' }
): OrderPricing {
  const ms = settings || {};
  const safeSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;

  const discountPct = Math.min(toPositiveNumber(ms.onlineDiscount), 100);
  const discount = round2((safeSubtotal * discountPct) / 100);

  const threshold = toPositiveNumber(ms.freeDeliveryThreshold);
  const qualifiesForFreeDelivery = threshold > 0 && safeSubtotal >= threshold;

  let deliveryFee = 0;
  if (options.deliveryType === 'delivery' && safeSubtotal > 0 && !qualifiesForFreeDelivery) {
    deliveryFee = toNonNegativeNumber(ms.deliveryFee);
  }

  const minimumOrder = toPositiveNumber(ms.deliveryMinOrder ?? ms.minimumOrder);
  const loyaltyDiscount = toNonNegativeNumber(options.loyaltyDiscount);

  return {
    subtotal: safeSubtotal,
    discount,
    deliveryFee,
    loyaltyDiscount,
    minimumOrder,
    belowMinimum: safeSubtotal > 0 && minimumOrder > 0 && safeSubtotal < minimumOrder,
    total: Math.max(0, round2(safeSubtotal - discount + deliveryFee - loyaltyDiscount)),
  };
}
