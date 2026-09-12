import fs from 'node:fs';
import assert from 'node:assert/strict';

const read = path => fs.readFileSync(path, 'utf8');

const additive = read('supabase/migrations/20260912130000_add_guest_security_endpoints.sql');
const trigger = read('supabase/migrations/20260912130500_secure_order_push_trigger.sql');
const lockdown = read('supabase/migrations/20260912133000_lock_guest_security_legacy.sql');
const supabaseClient = read('src/supabase.ts');
const pushClient = read('src/utils/pushNotifications.ts');
const lookup = read('src/components/TrackOrderLookup.tsx');
const edge = read('supabase/functions/send-order-push/index.ts');

assert.match(additive, /upsert_customer_order_push_subscription/);
assert.match(additive, /o\.access_token\s*=\s*p_access_token/);
assert.match(additive, /get_guest_order_by_code/);
assert.match(additive, /p_customer_phone/);
assert.match(additive, /submit_store_rating_verified/);
assert.match(additive, /lower\(coalesce\(o\.status, ''\)\) = 'completed'/);
assert.doesNotMatch(additive, /p_event_type in \([^)]*order_placed/i);
assert.match(additive, /p_event_type not in \('qr_scan','store_code_lookup','store_view','product_view','cart_started','checkout_started'\)/);

assert.match(trigger, /vault\.create_secret/);
assert.match(trigger, /x-storeflow-internal-secret/);
assert.match(trigger, /verify_order_push_internal_secret/);
assert.match(trigger, /'event', 'new_order'/);
assert.match(trigger, /'event', 'status_update'/);

assert.match(lockdown, /revoke execute on function public\.upsert_customer_push_subscription/);
assert.match(lockdown, /revoke execute on function public\.get_order_by_number/);
assert.match(lockdown, /revoke execute on function public\.submit_store_rating/);

assert.match(pushClient, /upsert_customer_order_push_subscription/);
assert.doesNotMatch(pushClient, /upsert_customer_push_subscription/);
assert.match(pushClient, /getStoredOrderCredentials/);

assert.match(lookup, /get_guest_order_by_code/);
assert.match(lookup, /p_order_number/);
assert.match(lookup, /p_customer_phone/);
assert.doesNotMatch(lookup, /get_order_by_number/);

assert.match(supabaseClient, /queued_by: 'database_trigger'/);
assert.match(supabaseClient, /submit_store_rating_verified/);
assert.doesNotMatch(supabaseClient, /notifyMerchantOfNewOrder/);

assert.match(edge, /x-storeflow-internal-secret/);
assert.match(edge, /verify_order_push_internal_secret/);
assert.match(edge, /customer_order_push_subscriptions/);
assert.doesNotMatch(edge, /customer_push_subscriptions/);
assert.doesNotMatch(edge, /bodyJson\.new_status|body\.new_status|initiated_by/);

console.log('guest trust-boundary regression checks passed');
