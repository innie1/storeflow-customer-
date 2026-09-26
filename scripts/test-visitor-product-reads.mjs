import { readAppSource } from './lib/appSource.mjs';

/**
 * A visitor may read only some columns of `products`.
 *
 * The cloud grants anonymous visitors a named list of product columns - cost
 * price and profit are deliberately left out - and `is_service` is not on it.
 * The app asked for `is_service`, so the cloud refused the whole request. For
 * a shop with no products listed yet, that refusal was thrown as a failure
 * and the storefront said "Offline Mode" instead of "no products". A product's
 * own QR code looked in the same table, which is empty (catalogues live in the
 * store record), and never found anything.
 */

const source = readAppSource();
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

const productReads = [...source.matchAll(/\.from\('products'\)\s*\.select\('([^']*)'\)/g)].map(match => match[1]);
check(productReads.length > 0, 'expected the app to read products somewhere');
for (const columns of productReads) {
  check(!/\bis_service\b/.test(columns), `a visitor product read asks for is_service, which visitors may not read: ${columns}`);
  check(!/\bcost_price\b|\btotal_profit\b/.test(columns), `a visitor product read asks for a column hidden from visitors: ${columns}`);
}

check(!/if \(prodErr\) throw prodErr;/.test(source), 'a refused product read must not fail the whole store load');

const qrStart = source.indexOf('if (parsedProductId) {');
const qrBlock = source.slice(qrStart, qrStart + 1200);
check(qrStart >= 0 && /storeflow_cached_products_/.test(qrBlock), "a product QR code must look in the store's loaded catalogue first");

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Visitor product read checks passed.');
