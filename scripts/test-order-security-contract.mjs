import assert from 'node:assert/strict';
import { readFile } from './lib/appSource.mjs';

const client = readFile('src/supabase.ts');
const migration = readFile('supabase/migrations/20260912111500_secure_token_checkout.sql');

// The historical UI contract remains place_order_atomic, but no browser call is
// allowed to reach that privileged RPC directly.
assert.match(client, /fn === 'place_order_atomic'/,
  'the customer wrapper must continue intercepting the existing checkout call');
assert.match(client, /originalRpc\('place_order_secure'/,
  'checkout must be redirected to the server-authoritative RPC');
assert.match(client, /saveOrderAccessToken\(orderId, token\)/,
  'secure checkout must persist the one-time returned order credential');

// Phone-only history/status/token recovery must be replaced by local order
// credentials. A phone number is an identifier, not an authorization secret.
assert.match(client, /get_customer_orders_by_tokens/,
  'order history must use token-scoped lookup');
assert.match(client, /get_customer_order_status_by_token/,
  'order status must use token-scoped lookup');
assert.match(client, /getOrderAccessToken/,
  'customer actions must load their per-order credential');
assert.doesNotMatch(client, /storeflow:offline-order-queue:v2/,
  'the duplicate wrapper offline queue must stay removed');
assert.doesNotMatch(client, /offline-\$\{Date\.now\(\)\}/,
  'the wrapper must never fabricate a successful fake order id');

// Server owns status and money.
assert.match(migration, /'Pending',\s*\n\s*v_subtotal,\s*\n\s*v_total/,
  'secure checkout must hard-code Pending and pass its own calculated total');
assert.match(migration, /v_total := round\(greatest\(0, v_subtotal - v_online_discount \+ v_delivery_fee - v_loyalty_discount\), 2\)/,
  'secure checkout must calculate the final total server-side');
assert.match(migration, /'server_pricing', true/,
  'server-verified pricing must be marked in stored notes');

// Legacy bypasses must be shut after the customer app is deployed.
for (const signature of [
  'get_customer_orders(text)',
  'get_customer_order_status(uuid,text)',
  'get_order_access_token(uuid,text)',
  'redeem_customer_loyalty(uuid,text,uuid)',
  'place_order_atomic(text,text,text,text,text,numeric,numeric,text,jsonb,uuid,boolean)',
]) {
  assert.ok(migration.includes(`revoke execute on function public.${signature}`),
    `migration must revoke ${signature}`);
}
assert.match(migration, /drop policy if exists "Customer orders INSERT" on public\.orders/,
  'raw customer order inserts must be removed');
assert.match(migration, /drop policy if exists "Customer order items INSERT" on public\.order_items/,
  'raw customer order-item inserts must be removed');

// Cancel/approve actions must reject a missing token.
assert.match(migration, /nullif\(trim\(coalesce\(p_access_token, ''\)\), ''\) is null/,
  'customer mutation RPCs must require an access token');

console.log('Secure order/token contract checks passed.');
