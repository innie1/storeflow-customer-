import assert from 'node:assert/strict';
import { readFile } from './lib/appSource.mjs';

const source = readFile('src/components/ServiceBusinessExperience.tsx');
const main = readFile('src/main.tsx');

assert.doesNotMatch(main, /ServiceBusinessExperience/,
  'the legacy laundry-only experience must never be mounted over the unified customer app');

assert.match(source, /await resolvePublicStore\(identifier\)/,
  'service storefront must use the shared store-specific public resolver');
assert.match(source, /template\.laundryPricing \|\| data\.laundryPricing \|\| data\.laundry_pricing/,
  'laundry storefront must consume the merchant-published laundry pricing configuration');
assert.match(source, /garmentUnitPrice\(selected, pricingConfig, name\)/,
  'laundry clothing cards must show the selected service price for each garment');
assert.match(source, /garment_lines: type === 'laundry'/,
  'laundry requests must save a garment-by-garment price snapshot');
assert.match(source, /service_metadata: request/,
  'service requests must persist structured service metadata for the merchant app');
assert.match(source, /identityMissing = !customerName\.trim\(\) \|\| !customerPhone\.trim\(\)/,
  'customer name and phone must be required before a public order is created');
assert.match(source, /getFulfillmentOptions\(template\)/,
  'pickup and delivery choices must come from the selected store configuration');
assert.match(source, /These clothing types and prices come directly from/,
  'customer-facing laundry copy must make store-specific pricing explicit');

console.log('Store-specific service storefront regression checks passed.');
