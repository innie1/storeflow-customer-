/**
 * Guards the shape of the order the customer app sends to the merchant.
 *
 * place_order_atomic is the single contract between this app, Supabase and the
 * merchant store. Getting a parameter name, the notes payload or the item shape
 * wrong does not fail loudly — the order is simply rejected, or lands without
 * the information the merchant needs to fulfil it. These checks exist so a UI
 * refactor cannot quietly change any of that.
 *
 * If you are here because this test failed: you changed the order contract.
 * That is a database-and-merchant-app change, not a customer-app change.
 */
import assert from 'node:assert/strict';
import { readAppSource, readFile } from './lib/appSource.mjs';

const src = readAppSource();
const client = readFile('src/supabase.ts');

// ── The RPC and its exact parameter list ────────────────────────────────────
const REQUIRED_PARAMS = [
  'p_store_id',
  'p_customer_name',
  'p_customer_phone',
  'p_order_number',
  'p_status',
  'p_subtotal',
  'p_total',
  'p_notes',
  'p_items',
];

// Every call site, not just the first: the app places orders from submitOrder
// and replays queued ones from syncOfflineOrders, and both must send the full
// parameter list.
const calls = [...src.matchAll(/place_order_atomic',\s*\{([\s\S]*?)\}\)/g)];
assert.ok(calls.length >= 2,
  `expected the live and offline-replay order calls, found ${calls.length}`);
for (const [index, call] of calls.entries()) {
  for (const param of REQUIRED_PARAMS) {
    assert.ok(call[1].includes(`${param}:`),
      `place_order_atomic call #${index + 1} must still send ${param}`);
  }
}

// The guest identity fields are injected by the client wrapper, not the caller.
assert.match(client, /p_customer_uuid: params\.p_customer_uuid \?\? null/,
  'the Supabase wrapper must keep defaulting p_customer_uuid for guest orders');
assert.match(client, /p_is_guest: params\.p_is_guest \?\? true/,
  'the Supabase wrapper must keep defaulting p_is_guest for guest orders');

// ── Each line item the merchant needs to pick the order ─────────────────────
const items = src.match(/const itemsPayload = cart\.map\(item => \(\{([\s\S]*?)\}\)\);/);
assert.ok(items, 'order items must still be built from the cart');
for (const field of ['product_id', 'quantity', 'price', 'subtotal']) {
  assert.ok(items[1].includes(`${field}:`), `each order item must still carry ${field}`);
}

// ── The notes blob the merchant app reads for fulfilment ────────────────────
const notes = src.match(/const notes = JSON\.stringify\(\{([\s\S]*?)\n    \}\);/);
assert.ok(notes, 'order notes must still be a JSON payload');
for (const field of [
  'customer_uuid',
  'is_guest',
  'delivery_type',
  'address',
  'payment_method',
  'instructions',
  'pricing_mode',
  'store_name',
  'items_summary',
]) {
  assert.ok(notes[1].includes(`${field}:`), `order notes must still carry ${field}`);
}

// ── Never send an order to a store the customer is not looking at ───────────
assert.match(src, /const targetStoreId = store\?\.id \|\| '';/,
  'orders must be addressed to the store currently on screen');
assert.match(src, /if \(!orderPayload\.store_id\) \{/,
  'an order with no resolved store must be refused rather than sent');

// ── Offline orders must replay through the same RPC ─────────────────────────
const offline = src.match(/const syncOfflineOrders = async \(\) => \{([\s\S]*?)\n  \};/);
assert.ok(offline, 'the offline order queue must still exist');
assert.ok(offline[1].includes("supabase.rpc('place_order_atomic'"),
  'queued offline orders must replay through place_order_atomic, never a raw insert');
// Scoped to the mounted tree. src/components/ServiceBusinessExperience.tsx
// still contains a raw orders insert, but it is never rendered — main.tsx is
// asserted not to mount it in test-store-specific-service-flow.mjs. It is dead
// code that should be deleted; until then it must not fail this check, and it
// must not come back to life carrying that insert either.
const live = readFile('src/App.tsx') + readFile('src/components/LaundryStorefront.tsx');
assert.ok(!/\.from\('orders'\)\s*\.insert/.test(live),
  'orders must never be inserted directly, bypassing the atomic RPC');

console.log('Order submission contract checks passed.');
