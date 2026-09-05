import { readFile } from './lib/appSource.mjs';

/**
 * A customer buying biscuits was shown this on the tracking screen:
 *
 *   "Service for this project is restricted due to the following violations:
 *    exceed_egress_quota. The project owner must upgrade their plan or remove
 *    spend caps to restore service. — please go back to your cart and try again."
 *
 * The checkout printed whatever the server said, verbatim. That message names
 * an internal quota, explains how the platform is billed, tells the customer
 * to do something only the operator can do, and then blames their cart.
 *
 * These run the real classifier against the real string.
 */

const source = readFile('src/utils/orderErrors.ts');

// The module is plain TypeScript with no imports, so the types can be stripped
// with a couple of substitutions and the real logic executed — no build step,
// and no second copy of the rules to drift out of sync with the app.
const js = source
  .replace(/^export type [\s\S]*?;$/m, '')
  .replace(/^export interface [\s\S]*?^}/m, '')
  .replace(/: OrderFailureKind\b/g, '')
  .replace(/: OrderFailure\b/g, '')
  .replace(/: string\b/g, '')
  .replace(/: boolean\b/g, '')
  .replace(/: any\b/g, '')
  .replace(/const OPERATOR_TERMS = \[/, 'const OPERATOR_TERMS = [');

const module = await import(
  `data:text/javascript,${encodeURIComponent(js)}`
);
const { describeOrderFailure, describeActionFailure, orderFailureTitle } = module;

function assert(condition, label) {
  if (!condition) throw new Error(label);
}

// Node 25 defines navigator as a getter, so it is redefined rather than assigned.
const setOnline = (onLine) =>
  Object.defineProperty(globalThis, 'navigator', { value: { onLine }, configurable: true });

setOnline(true);

// ── The exact failure a customer was shown ──────────────────────────────────
const suspended = {
  message:
    'Service for this project is restricted due to the following violations: exceed_egress_quota. ' +
    'The project owner must upgrade their plan or remove spend caps to restore service.',
};
const suspendedResult = describeOrderFailure(suspended);

assert(suspendedResult.kind === 'service', 'a suspended project is a service fault, not a rejected order');
for (const leak of ['quota', 'spend cap', 'upgrade', 'project owner', 'restricted']) {
  assert(
    !suspendedResult.message.toLowerCase().includes(leak),
    `customer message still leaks operator detail: ${leak}`,
  );
}
assert(!suspendedResult.message.includes('cart'), 'a service outage must not blame the customer cart');

// ── Business rules the customer can actually act on still come through ──────
for (const [message, expected] of [
  ['Not enough stock for product Cabin Biscuit', 'Not enough stock'],
  ['Price changed for product Rice 50kg; please refresh your cart', 'Price changed'],
  ['Product is no longer available', 'no longer available'],
  ['Order subtotal is out of date; please review your cart', 'out of date'],
]) {
  const result = describeOrderFailure({ code: 'P0001', message });
  assert(result.kind === 'rejected', `"${message}" should be reported as a rejection`);
  assert(result.message.includes(expected), `"${message}" should reach the customer`);
}

// ── An unlabelled server error is never quoted ──────────────────────────────
const unknown = describeOrderFailure({ message: 'relation "orders" does not exist' });
assert(unknown.kind === 'service', 'an unrecognised error is a service fault');
assert(!unknown.message.includes('relation'), 'raw database text must never reach a customer');

// Even a business-rule code cannot smuggle operator detail through.
const smuggled = describeOrderFailure({ code: 'P0001', message: 'Supabase quota exceeded for this project' });
assert(smuggled.kind === 'service', 'operator wording is replaced even when raised as a business rule');

// ── Offline still queues, and says so ───────────────────────────────────────
const offline = describeOrderFailure({ message: 'Failed to fetch' });
assert(offline.kind === 'offline', 'a network failure is an offline failure');
assert(offline.message.toLowerCase().includes('offline'), 'offline message says so');

setOnline(false);
assert(describeOrderFailure({ message: 'anything' }).kind === 'offline', 'no connection means offline');
setOnline(true);

// ── The banner heading follows the kind ─────────────────────────────────────
assert(orderFailureTitle('offline').toLowerCase().includes('saved'), 'offline heading says the order is kept');
assert(!orderFailureTitle('service').toLowerCase().includes('queued'), 'a service outage is not "queued"');
assert(!orderFailureTitle('rejected').toLowerCase().includes('queued'), 'a rejected order is not "queued"');

// ── Only an offline order is kept for later ─────────────────────────────────
const app = readFile('src/App.tsx');
assert(
  app.includes("if (failure.kind === 'offline') {"),
  'only an offline failure should queue the order for retry',
);
assert(
  !app.includes('please go back to your cart and try again'),
  'the old verbatim server-message path is gone',
);

// ── Other customer actions leak nothing either ─────────────────────────────
const ratingFailure = describeActionFailure(suspended, 'submit your rating');
for (const leak of ['quota', 'spend cap', 'upgrade', 'project owner', 'restricted']) {
  assert(!ratingFailure.toLowerCase().includes(leak), `rating failure leaks ${leak}`);
}
assert(ratingFailure.includes('submit your rating'), 'the action is named back to the customer');

const reviews = readFile('src/components/StoreReviewsModal.tsx');
assert(!reviews.includes("err.message"), 'rating errors no longer print the raw server message');
assert(!app.includes("'Failed to approve proposal: '"), 'approval errors no longer print the raw server message');

console.log('Order error message regressions passed.');
