/**
 * Behavioural checks for order pricing.
 *
 * The rest of this suite asserts on the text of src/App.tsx. These run the
 * real function, because the bug being guarded against was arithmetic: the
 * store page advertised the merchant's delivery fee, free-delivery threshold,
 * online discount and minimum order, while the cart and submitOrder each
 * hard-coded "₦500, free over ₦5,000" and ignored all four.
 */
import assert from 'node:assert/strict';

// Node strips the type annotations, so the real module is imported directly
// rather than a transpiled or re-implemented copy of it.
const { computeOrderPricing } = await import('../src/utils/orderPricing.ts');

assert.equal(typeof computeOrderPricing, 'function', 'orderPricing must export computeOrderPricing');

const store = { deliveryFee: 1200, freeDeliveryThreshold: 8000, onlineDiscount: 10, deliveryMinOrder: 1500 };

// Delivery is charged at the merchant's rate, not a hard-coded ₦500.
{
  const p = computeOrderPricing(5000, store, { deliveryType: 'delivery' });
  assert.equal(p.deliveryFee, 1200, 'delivery fee must come from marketplaceSettings.deliveryFee');
  assert.equal(p.discount, 500, '10% of ₦5,000 must be discounted');
  assert.equal(p.total, 5700, '5000 - 500 discount + 1200 delivery');
}

// Free delivery uses the merchant's threshold, not a hard-coded ₦5,000.
{
  const under = computeOrderPricing(7999, store, { deliveryType: 'delivery' });
  assert.equal(under.deliveryFee, 1200, 'below the merchant threshold delivery is still charged');
  const over = computeOrderPricing(8000, store, { deliveryType: 'delivery' });
  assert.equal(over.deliveryFee, 0, 'at the merchant threshold delivery becomes free');
}

// Pickup is never charged a delivery fee.
assert.equal(computeOrderPricing(5000, store, { deliveryType: 'pickup' }).deliveryFee, 0);

// A store that publishes no delivery fee must not invent one.
{
  const p = computeOrderPricing(5000, { deliveryEnabled: true }, { deliveryType: 'delivery' });
  assert.equal(p.deliveryFee, 0, 'an unconfigured delivery fee is 0, never a placeholder');
  assert.equal(p.discount, 0, 'no discount is applied unless the merchant published one');
  assert.equal(p.total, 5000);
}

// The minimum order is read from the key the merchant app actually writes.
{
  assert.equal(computeOrderPricing(1000, store, { deliveryType: 'pickup' }).belowMinimum, true);
  assert.equal(computeOrderPricing(1500, store, { deliveryType: 'pickup' }).belowMinimum, false);
  const legacy = computeOrderPricing(1000, { minimumOrder: 1500 }, { deliveryType: 'pickup' });
  assert.equal(legacy.belowMinimum, true, 'the legacy minimumOrder key is still honoured');
  assert.equal(computeOrderPricing(0, store, { deliveryType: 'pickup' }).belowMinimum, false,
    'an empty cart is not "below the minimum"');
}

// Loyalty redemption stacks on top and can never produce a negative total.
{
  const p = computeOrderPricing(1000, store, { deliveryType: 'pickup', loyaltyDiscount: 5000 });
  assert.equal(p.total, 0, 'a total can never go below zero');
}

// Garbage settings must not produce NaN totals.
for (const bad of [null, undefined, { deliveryFee: 'abc', onlineDiscount: 'x', deliveryMinOrder: null }]) {
  const p = computeOrderPricing(2500, bad, { deliveryType: 'delivery' });
  assert.ok(Number.isFinite(p.total), 'total stays finite for unusable settings');
  assert.equal(p.total, 2500);
}

// A discount over 100% cannot pay the customer.
{
  const p = computeOrderPricing(1000, { onlineDiscount: 500 }, { deliveryType: 'pickup' });
  assert.equal(p.discount, 1000, 'discount is capped at 100%');
  assert.equal(p.total, 0);
}

// ── The merchant's real reward keys ─────────────────────────────────────────
// There is no `onlineDiscount` key anywhere in the merchant app. Its
// promotions section writes onlineOrderRewardType/Value, and expresses free
// delivery as deliveryRewardType: 'free' over deliveryMinSpend.
{
  const pct = computeOrderPricing(5000, { onlineOrderRewardType: 'percentage', onlineOrderRewardValue: 5 }, { deliveryType: 'pickup' });
  assert.equal(pct.discount, 250, '5% of 5,000');

  const flat = computeOrderPricing(5000, { onlineOrderRewardType: 'flat', onlineOrderRewardValue: 750 }, { deliveryType: 'pickup' });
  assert.equal(flat.discount, 750, 'a flat reward comes off in naira, not percent');

  const capped = computeOrderPricing(500, { onlineOrderRewardType: 'flat', onlineOrderRewardValue: 900 }, { deliveryType: 'pickup' });
  assert.equal(capped.discount, 500, 'a flat reward can never exceed the subtotal');

  for (const type of ['points', 'none']) {
    const p = computeOrderPricing(5000, { onlineOrderRewardType: type, onlineOrderRewardValue: 5 }, { deliveryType: 'pickup' });
    assert.equal(p.discount, 0, `'${type}' is not money off`);
  }

  // Free delivery expressed the promotions way.
  const under = computeOrderPricing(4999, { deliveryFee: 1200, deliveryRewardType: 'free', deliveryMinSpend: 5000 }, { deliveryType: 'delivery' });
  assert.equal(under.deliveryFee, 1200, 'below deliveryMinSpend the fee still applies');
  const over = computeOrderPricing(5000, { deliveryFee: 1200, deliveryRewardType: 'free', deliveryMinSpend: 5000 }, { deliveryType: 'delivery' });
  assert.equal(over.deliveryFee, 0, 'at deliveryMinSpend delivery becomes free');

  // The legacy key still works for settings saved before the rename.
  const legacy = computeOrderPricing(1000, { onlineDiscount: 10 }, { deliveryType: 'pickup' });
  assert.equal(legacy.discount, 100, 'legacy onlineDiscount is still honoured');
}

console.log('Order pricing regressions passed.');
