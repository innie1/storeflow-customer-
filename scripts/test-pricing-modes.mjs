import { readAppSource } from './lib/appSource.mjs';

/**
 * The merchant's retail/wholesale choice never reached the customer.
 *
 * A merchant sets one thing — a pricing mode of retail, wholesale or both. It
 * is stored on marketplaceSettings, and both the storefront RPC and the
 * directory listing deliver marketplaceSettings.
 *
 * This app read `store.data.managerSettings.retailPricingEnabled` instead —
 * a merchant-side mirror of the same setting that is in neither payload. It
 * was always undefined, so the guard fell straight through to "true" and every
 * shop was shown as though it offered both prices, whatever the merchant had
 * chosen.
 */

function fail(message) {
  throw new Error(message);
}

function expectContains(text, needle, label) {
  if (!text.includes(needle)) fail(`${label}: missing ${needle}`);
}

const app = readAppSource();

// ── It reads the field that actually arrives ────────────────────────────────
expectContains(app, "marketplaceSettings?.pricingMode", 'pricing mode is read from marketplaceSettings');
expectContains(app, 'const pricingMode = useMemo', 'the mode is resolved once');

// Only the three the merchant can set are honoured; anything else is ignored
// rather than being taken as a mode.
expectContains(
  app,
  "mode === 'retail' || mode === 'wholesale' || mode === 'both' ? mode : null",
  'an unrecognised mode is not trusted',
);

// ── The mode decides, and it decides both ways ──────────────────────────────
expectContains(app, "if (pricingMode) return pricingMode !== 'wholesale';", 'retail follows the mode');
expectContains(app, "if (pricingMode) return pricingMode !== 'retail';", 'wholesale follows the mode');

// ── The old field still works where a store happens to carry it ─────────────
expectContains(app, 'settings?.retailPricingEnabled === false', 'the managerSettings mirror is still honoured');
expectContains(app, 'settings?.wholesalePricingEnabled === true', 'the wholesale mirror is still honoured');

// ── And a store that says nothing still behaves ─────────────────────────────
// No mode, no mirror: retail on, and wholesale only where there is a distinct
// wholesale price to show.
expectContains(app, 'products.some(p => p.wholesale_price !== p.retail_price)', 'the no-setting fallback survives');

// ── The mode drives what the shopper is shown ───────────────────────────────
expectContains(app, 'isWholesaleEnabled && !isRetailEnabled', 'a wholesale-only store opens in wholesale');

console.log('Pricing mode regressions passed.');
