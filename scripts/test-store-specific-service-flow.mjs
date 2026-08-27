import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/components/ServiceBusinessExperience.tsx', import.meta.url), 'utf8');

assert.match(source, /id,store_id,access_code,business_name,currency,country,state,city,address,phone,email,logo,data/,
  'public storefront must request store-specific public branding and contact fields');
assert.match(source, /candidates = uuidLike \? \['id', 'store_id', 'access_code'\] : \['store_id', 'access_code'\]/,
  'store lookup must support UUID, legacy store ID, and access code routes');
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
