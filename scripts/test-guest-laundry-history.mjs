import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const laundry = fs.readFileSync(new URL('../src/components/LaundryStorefront.tsx', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260829232352_guest_laundry_order_history.sql', import.meta.url), 'utf8');

assert.match(app, /getStoreBusinessType\(store\) === 'laundry'[\s\S]*<LaundryStorefront/,
  'laundry stores must render the dedicated self-service intake instead of the generic empty catalog');
assert.match(laundry, /pricing\.garmentTypes/,
  'the clothing list must come from this merchant published laundry configuration');
assert.doesNotMatch(laundry, /DEFAULT_(?:CLOTHES|LAUNDRY)/,
  'the customer must not receive a generic fallback laundry catalog');
assert.match(laundry, /Tap \+ to add an item to your cart/,
  'the customer catalogue must explain its standard add-to-cart control');
assert.match(laundry, /grid grid-cols-2 gap-3 sm:grid-cols-3/,
  'laundry clothing choices must use a compact responsive product grid');
assert.match(laundry, /View Cart[\s\S]*My Cart \(\{pieces\}\)[\s\S]*Continue to Checkout/,
  'laundry selections must use the established StoreFlow cart and checkout pattern');
assert.doesNotMatch(laundry, /Your laundry basket/,
  'laundry must not introduce a second basket section below the item catalogue');
assert.match(laundry, /line\.quantity \* line\.price/,
  'the customer cart must recalculate each line from the merchant-published price');
assert.match(laundry, /dark:bg-zinc-900[\s\S]*dark:text-zinc-100[\s\S]*dark:bg-\[#FFD23F\]/,
  'the laundry storefront must define explicit readable dark-mode surfaces and selected states');
assert.match(laundry, /offerings\.some\(\(item: LaundryOffering\) => item\.id === selectedServiceId\)/,
  'the selected treatment must stay valid when the merchant republishes the catalogue');
assert.match(laundry, /Customer name[\s\S]*Phone number[\s\S]*Address/,
  'customer laundry intake must collect name, phone, and address');
assert.match(laundry, /rpc\('customer_place_laundry_order'/,
  'laundry submission must use the server-validated atomic RPC');
assert.doesNotMatch(laundry, /from\('orders'\)\.insert/,
  'the browser must not insert an unvalidated laundry order directly');
assert.match(app, /rpc\('get_customer_orders_by_tokens'/,
  'guest order history must refresh through private per-order tokens');
assert.match(app, /saveOrderAccessToken\(String\(placed\.id\), String\(placed\.access_token\)\)/,
  'a newly placed laundry order must be remembered on this device');
assert.match(app, /channel\(`store-updates-\$\{store\.id\}-\$\{channelInstance\}`\)/,
  'store catalogue refreshes must use a remount-safe realtime channel');

assert.match(migration, /join valid_credentials credential[\s\S]*credential\.access_token = o\.access_token/,
  'history RPC must only return orders whose id and private token both match');
assert.match(migration, /v_pricing := coalesce\(v_store\.data->'laundryPricing'/,
  'server pricing must use this store published laundry price list');
assert.match(migration, /insert into public\.laundry_order_items/,
  'customer submissions must enter the merchant laundry workflow');
assert.doesNotMatch(migration, /p_total numeric/,
  'the customer must not be allowed to provide the authoritative order total');

console.log('Guest laundry order history regression checks passed.');
