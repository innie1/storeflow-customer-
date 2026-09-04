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
  /** What the merchant app writes. */
  deliveryMinOrder?: unknown;
  /** Older name for the same thing. */
  minimumOrder?: unknown;

  /**
   * The merchant's actual online-order reward. There is no `onlineDiscount`
   * key anywhere in the merchant app — its promotions section writes these
   * two. 'points' awards loyalty points rather than money off, so it is not a
   * discount here.
   */
  onlineOrderRewardType?: unknown;
  onlineOrderRewardValue?: unknown;

  /** Free delivery over `deliveryMinSpend`, the merchant's other spelling of a threshold. */
  deliveryRewardType?: unknown;
  deliveryMinSpend?: unknown;

  /** Legacy percentage discount, kept so older stored settings still work. */
  onlineDiscount?: unknown;
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

/** Money off this order, from whichever reward the merchant configured. */
function resolveDiscount(ms: MarketplaceSettings, subtotal: number): number {
  const rewardType = String(ms.onlineOrderRewardType ?? '');
  const rewardValue = toPositiveNumber(ms.onlineOrderRewardValue);

  if (rewardType === 'percentage') return (subtotal * Math.min(rewardValue, 100)) / 100;
  if (rewardType === 'flat') return Math.min(rewardValue, subtotal);
  // 'points' pays in loyalty points and 'none' pays nothing; neither is money off.
  if (rewardType === 'points' || rewardType === 'none') return 0;

  const legacyPct = Math.min(toPositiveNumber(ms.onlineDiscount), 100);
  return (subtotal * legacyPct) / 100;
}

export function computeOrderPricing(
  subtotal: number,
  settings: MarketplaceSettings | null | undefined,
  options: { deliveryType: 'pickup' | 'delivery'; loyaltyDiscount?: number } = { deliveryType: 'pickup' }
): OrderPricing {
  const ms = settings || {};
  const safeSubtotal = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;

  const discount = round2(resolveDiscount(ms, safeSubtotal));

  // Two spellings of the same idea: an explicit freeDeliveryThreshold, or the
  // promotions section's "free delivery over deliveryMinSpend".
  const threshold = toPositiveNumber(ms.freeDeliveryThreshold)
    || (String(ms.deliveryRewardType) === 'free' ? toPositiveNumber(ms.deliveryMinSpend) : 0);
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
