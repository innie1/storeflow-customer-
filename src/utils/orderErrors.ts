/**
 * Decides what a customer is told when placing an order fails.
 *
 * The checkout used to print whatever the server said, verbatim. When the
 * Supabase project was suspended, shoppers were shown:
 *
 *   "Service for this project is restricted due to the following violations:
 *    exceed_egress_quota. The project owner must upgrade their plan or remove
 *    spend caps to restore service. — please go back to your cart and try again."
 *
 * That is an operator's billing problem written to a customer buying biscuits.
 * It leaks how the platform is hosted, names an internal quota, tells the
 * customer to do something they cannot do, and then blames their cart.
 *
 * So messages are allow-listed rather than filtered. place_order_atomic raises
 * its own business rules through plpgsql, which arrive with SQLSTATE P0001 —
 * "Not enough stock for product X", "Price changed; please refresh your cart".
 * Those are worth reading and the customer can act on them. Anything else is
 * infrastructure, and the honest thing to say is that it is our fault and to
 * try again shortly.
 */

export type OrderFailureKind =
  /** No usable connection. The order is kept and sent later. */
  | 'offline'
  /** The store or the rules rejected it. The customer can fix this. */
  | 'rejected'
  /** Our side broke. Nothing for the customer to fix. */
  | 'service';

export interface OrderFailure {
  kind: OrderFailureKind;
  /** Safe to show a customer, always. */
  message: string;
}

/** SQLSTATE for a plpgsql `raise exception` — our own business rules. */
const BUSINESS_RULE_SQLSTATE = 'P0001';

/**
 * Words that must never reach a shopper, whatever the server calls them.
 *
 * A second line of defence: even a P0001 message would be replaced if it
 * somehow carried operator detail, so a future server-side message cannot
 * reintroduce the leak this file exists to stop.
 */
const OPERATOR_TERMS = [
  'quota', 'spend cap', 'upgrade their plan', 'upgrade your plan', 'project owner',
  'supabase', 'postgres', 'postgrest', 'jwt', 'api key', 'apikey', 'service role',
  'database', 'sqlstate', 'stack', 'internal server', 'restricted due to',
];

const SERVICE_MESSAGE =
  'We could not reach the store just now. Your order has not been placed — please try again in a few minutes.';

const OFFLINE_MESSAGE =
  'You appear to be offline — your order has been saved and will be sent automatically when connectivity returns.';

function looksOperational(text: string): boolean {
  const lower = text.toLowerCase();
  return OPERATOR_TERMS.some(term => lower.includes(term));
}

function isNetworkFailure(error: any): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const text = `${error?.name || ''} ${error?.message || ''}`.toLowerCase();
  return (
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network') ||
    text.includes('fetch') ||
    text.includes('timeout') ||
    text.includes('offline')
  );
}

/**
 * Classifies a failed order submission.
 *
 * `kind` decides what the caller does with it — 'offline' is the only one that
 * should queue the order for later, because it is the only one where retrying
 * unchanged will eventually work.
 */
export function describeOrderFailure(error: any): OrderFailure {
  if (isNetworkFailure(error)) {
    return { kind: 'offline', message: OFFLINE_MESSAGE };
  }

  const raw = String(error?.message || '').replace(/^(Error|Exception):\s*/i, '').trim();

  // Only rules the order RPC raised deliberately are quoted back.
  const isBusinessRule = error?.code === BUSINESS_RULE_SQLSTATE;
  if (isBusinessRule && raw && !looksOperational(raw)) {
    // Server text is a sentence fragment at times; make sure it reads as one.
    const message = /[.!?]$/.test(raw) ? raw : `${raw}.`;
    return { kind: 'rejected', message };
  }

  return { kind: 'service', message: SERVICE_MESSAGE };
}

/** Heading for the banner that shows a failure, matching its kind. */
export function orderFailureTitle(kind: OrderFailureKind): string {
  if (kind === 'offline') return 'Order saved — waiting for signal';
  if (kind === 'rejected') return 'Order not placed';
  return 'Could not reach the store';
}

/** Material Symbols icon name for the banner. */
export function orderFailureIcon(kind: OrderFailureKind): string {
  if (kind === 'offline') return 'wifi_off';
  if (kind === 'rejected') return 'error';
  return 'cloud_off';
}

/**
 * A customer-safe sentence for any action that failed, not only checkout.
 *
 * Approving a merchant's changes and submitting a rating both used to alert
 * `'Failed to …: ' + error.message`, so they leaked the same operator text as
 * the checkout did.
 *
 * `what` completes the sentence "We could not …", so pass a verb phrase:
 * 'approve those changes', 'submit your rating'.
 */
export function describeActionFailure(error: any, what: string): string {
  const failure = describeOrderFailure(error);
  if (failure.kind === 'rejected') return failure.message;
  if (failure.kind === 'offline') {
    return `You appear to be offline, so we could not ${what}. Please try again once you have signal.`;
  }
  return `We could not ${what} just now. Please try again in a few minutes.`;
}
