import { readAppSource } from './lib/appSource.mjs';

/**
 * The Supabase project was suspended for exceeding its egress quota.
 *
 * The app was re-downloading the whole public store directory every 60
 * seconds, in every open tab, on every screen — and again on any change
 * anywhere in the `stores` table, via an unfiltered realtime subscription, so
 * one merchant saving a setting made every connected customer refetch the lot.
 * The directory carries each store's `data` blob, catalogue included, so those
 * were among the largest responses the app ever asked for.
 *
 * Two smaller leaks fed the same bill: the Tracking screen polled every three
 * seconds forever — including while the phone was in a pocket, and after the
 * order had already been Completed and could never change again — and the
 * order-history poll merely slowed down when the tab was hidden instead of
 * stopping, despite a visibilitychange handler that already re-fetches on
 * return.
 *
 * These pin the fixes. They are about traffic the customer never sees, so
 * nothing here should be relaxed without a reason that a customer would feel.
 */

function fail(message) {
  throw new Error(message);
}

function expectContains(text, needle, label) {
  if (!text.includes(needle)) fail(`${label}: missing ${needle}`);
}

function expectAbsent(text, needle, label) {
  if (text.includes(needle)) fail(`${label}: found ${needle}`);
}

const app = readAppSource();

// ── The store directory is not on a fetch timer ─────────────────────────────
expectAbsent(
  app,
  "table: 'stores' }",
  'no unfiltered realtime subscription on the whole stores table',
);
expectContains(app, 'lastStoresLoadRef', 'store directory tracks when it was last fetched');
expectContains(app, 'REFRESH_AFTER_MS', 'store directory refreshes on staleness, not on a fixed tick');

// A directory refresh must be gated on both staleness and the app being on
// screen; a bare interval that always fetches is what caused this.
const staleGuard = app.slice(app.indexOf('const refreshIfStale'), app.indexOf('const refreshIfStale') + 400);
expectContains(staleGuard, 'document.hidden', 'directory refresh skips a hidden page');
expectContains(staleGuard, 'lastStoresLoadRef.current', 'directory refresh skips a list that is still fresh');

// ── Order tracking stops when there is nothing to learn ─────────────────────
expectContains(app, 'TERMINAL_ORDER_STATUSES', 'tracking knows which statuses are final');
expectContains(app, 'settledRef', 'tracking records that an order has settled');

const terminalDecl = app.slice(app.indexOf('const TERMINAL_ORDER_STATUSES'), app.indexOf('const TERMINAL_ORDER_STATUSES') + 200);
for (const status of ['Completed', 'Rejected', 'Cancelled']) {
  expectContains(terminalDecl, status, `${status} counts as a final order status`);
}

const pollMs = Number(app.match(/const TRACKING_POLL_MS = (\d+)/)?.[1]);
if (!Number.isFinite(pollMs)) fail('tracking poll interval is not declared as a named constant');
if (pollMs < 5000) fail(`tracking polls every ${pollMs}ms — too aggressive for a status that changes a handful of times`);

// ── A hidden tab holds no timers ────────────────────────────────────────────
expectAbsent(app, 'const HIDDEN_MS', 'a hidden tab is stopped, not merely slowed');
const desired = app.slice(app.indexOf('const desiredInterval'), app.indexOf('const desiredInterval') + 220);
expectContains(desired, 'if (document.hidden) return 0', 'hidden means no order-history polling at all');
expectContains(app, '// Zero means hidden: hold no timer at all until the app is looked at.', 'the zero interval is documented where it is honoured');

console.log('Network efficiency regressions passed.');
