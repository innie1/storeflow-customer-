import StoreBrandMark from '../components/StoreBrandMark';
import type { TrackedOrder } from '../types';
import { orderFailureIcon, orderFailureTitle, type OrderFailureKind } from '../utils/orderErrors';

export interface TrackingOrderView {
  number: string;
  status: string;
  submitting: boolean;
  submitError: string | null;
  submitErrorKind?: OrderFailureKind;
  statusHistory: Array<{ status: string; at: string }>;
  processingStage: string | null;
  summary: TrackedOrder | null;
}

export interface TrackingCancelState {
  error: string | null;
  clearError: () => void;
  reason: string;
  setReason: (value: string) => void;
  reasons: string[];
  showConfirm: boolean;
  setShowConfirm: (value: boolean) => void;
  onCancel: (reason?: string) => void;
}

/** Stages every order walks through, in order. */
const TIMELINE_STAGES = ['Pending', 'Accepted', 'Preparing', 'Ready', 'Completed'];

const STAGE_LABELS: Record<string, string> = {
  Pending: 'Order placed',
  Accepted: 'Store accepted',
  Preparing: 'Being prepared',
  Ready: 'Ready',
  Completed: 'Completed',
};

/**
 * What the customer is told at each status.
 *
 * The old copy keyed one of these off 'Pending Approval', a status this app
 * never produces — the real one is 'Pending' — so a freshly placed order, by
 * far the most common state on this screen, showed a blank line under the
 * heading. The heading itself said "Order Placed! 🎉" for every status that
 * was not rejected or cancelled, so a completed order still congratulated the
 * customer on placing it.
 */
const STATUS_COPY: Record<string, { heading: string; detail: string; icon: string }> = {
  Pending: { heading: 'Order sent', detail: 'Waiting for the store to accept it.', icon: 'schedule' },
  Accepted: { heading: 'Order accepted', detail: 'The store has your order and will start soon.', icon: 'check_circle' },
  Preparing: { heading: 'Being prepared', detail: 'Staff are putting your order together.', icon: 'inventory_2' },
  Ready: { heading: 'Ready for you', detail: 'Your order is ready for pickup or delivery.', icon: 'check_circle' },
  'Out for Delivery': { heading: 'On its way', detail: 'Your order is out for delivery.', icon: 'local_shipping' },
  Delivered: { heading: 'Delivered', detail: 'Marked as delivered by the store.', icon: 'check_circle' },
  Completed: { heading: 'Completed', detail: 'This order is finished. Thanks for shopping.', icon: 'check_circle' },
  'Changes Requested': { heading: 'Changes requested', detail: 'The store has proposed a change to your order.', icon: 'info' },
  Rejected: { heading: 'Order rejected', detail: 'The store could not take this order.', icon: 'block' },
  Cancelled: { heading: 'Order cancelled', detail: 'This order was cancelled.', icon: 'close' },
};

function money(value: number) {
  return '₦' + Number(value || 0).toLocaleString();
}

function formatWhen(at: string) {
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function TrackingScreen({
  store,
  order,
  merchantMessage,
  cancel,
  busy,
  onApproveChanges,
  onBack,
  onViewStore,
  onViewOrders,
  onCopyOrderNumber,
  orderNumberCopied,
  onInstall,
  prepMinutes,
}: {
  store: any;
  order: TrackingOrderView;
  merchantMessage: { rejectionReason: string; changeRequestMessage: string };
  cancel: TrackingCancelState;
  busy: boolean;
  onApproveChanges: () => void;
  onBack: () => void;
  onViewStore: () => void;
  onViewOrders: () => void;
  onCopyOrderNumber: () => void;
  orderNumberCopied: boolean;
  onInstall: (() => void) | null;
  prepMinutes: number | null;
}) {
  const { status, submitting, statusHistory, processingStage, summary } = order;
  const failed = status === 'Rejected' || status === 'Cancelled';
  const copy = STATUS_COPY[status] ?? STATUS_COPY.Pending;
  const heading = submitting ? 'Sending order…' : copy.heading;
  const detail = submitting ? 'Confirming with the store — this only takes a moment.' : copy.detail;

  const historyByStatus = new Map(statusHistory.map(h => [h.status, h.at]));
  const currentStageIdx = TIMELINE_STAGES.indexOf(status);
  const canCancel = (status === 'Pending' || status === 'Accepted') && !submitting;

  const acceptedAt = historyByStatus.get('Accepted');
  const completedAt = historyByStatus.get('Completed');
  const elapsedMins = acceptedAt
    ? Math.max(1, Math.round(((completedAt ? new Date(completedAt).getTime() : Date.now()) - new Date(acceptedAt).getTime()) / 60000))
    : null;

  return (
    <div className="bg-[#F8F9FA] dark:bg-zinc-950 min-h-screen text-[#1A1C1E] dark:text-zinc-100 pb-28">
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-zinc-950/95 backdrop-blur-md flex justify-between items-center w-full h-16 border-b border-gray-100 dark:border-zinc-800 px-4">
        <button
          onClick={onBack}
          aria-label="Back"
          className="w-10 h-10 flex items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-900 active:scale-95 transition cursor-pointer"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </button>
        <span className="text-sm font-black tracking-wider uppercase">Track order</span>
        <div className="w-10 h-10" />
      </header>

      <main className="mt-4 px-4 md:px-8 max-w-md md:max-w-2xl lg:max-w-3xl mx-auto space-y-4 text-left">
        {/* Status, store and order number in one block instead of three. */}
        <section className="bg-white dark:bg-zinc-900 rounded-[20px] border border-gray-100 dark:border-zinc-800 shadow-sm p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${
                failed
                  ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400'
                  : 'bg-[#FFD23F]/20 text-[#1A1C1E] dark:text-[#FFD23F]'
              }`}
            >
              <span className={`material-symbols-outlined text-xl font-black ${submitting ? 'animate-spin' : ''}`}>
                {submitting ? 'progress_activity' : copy.icon}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-black tracking-tight">{heading}</h1>
              <p className="text-xs text-gray-500 dark:text-zinc-400 font-semibold leading-relaxed mt-0.5">{detail}</p>
              {/* The merchant's own published prep time — not an estimate made
                  up here, which is what the old "30-45 min" tile was. */}
              {prepMinutes !== null && !submitting && ['Pending', 'Accepted', 'Preparing'].includes(status) && (
                <p className="text-[11px] text-gray-400 dark:text-zinc-500 font-bold mt-1 inline-flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">schedule</span>
                  This store usually takes about {prepMinutes} min
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-gray-100 dark:border-zinc-800">
            <div className="flex items-center gap-2 min-w-0">
              {store && (
                <span className="w-6 h-6 rounded-full overflow-hidden bg-gray-100 dark:bg-zinc-800 shrink-0 flex items-center justify-center">
                  <StoreBrandMark store={store} />
                </span>
              )}
              <span className="text-xs font-bold text-gray-500 dark:text-zinc-400 truncate">
                {store?.business_name || 'Store'}
              </span>
            </div>
            <button
              onClick={onCopyOrderNumber}
              title="Copy order number"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-gray-50 dark:bg-zinc-950 border border-gray-100 dark:border-zinc-800 text-xs font-black font-mono cursor-pointer hover:bg-gray-100 dark:hover:bg-zinc-800 active:scale-95 transition shrink-0"
            >
              #{order.number}
              <span className="material-symbols-outlined text-sm">{orderNumberCopied ? 'check' : 'content_copy'}</span>
            </button>
          </div>
        </section>

        {/* The heading used to be "Order queued" with a no-signal icon for
            every failure — so a rejected order, or the platform being down,
            was reported to the customer as though it were waiting to send. */}
        {order.submitError && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 p-4 rounded-2xl text-xs space-y-1.5 shadow-sm">
            <h4 className="font-extrabold text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-base font-bold">
                {orderFailureIcon(order.submitErrorKind || 'service')}
              </span>
              {orderFailureTitle(order.submitErrorKind || 'service')}
            </h4>
            <p className="leading-relaxed font-medium">{order.submitError}</p>
          </div>
        )}

        {/*
          What was ordered and what it costs. The tracking screen used to show
          neither, so the only place a customer could see the amount they owed
          was the checkout sheet they had already left. It also showed an
          "Estimated Time" of "30–45 min" / "15–20 min" that was invented here
          and ignored whatever the merchant had published.
        */}
        {summary && (
          <section className="bg-white dark:bg-zinc-900 rounded-[20px] border border-gray-100 dark:border-zinc-800 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">
                Your order · {summary.items.length} {summary.items.length === 1 ? 'item' : 'items'}
              </h2>
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-gray-500 dark:text-zinc-400">
                <span className="material-symbols-outlined text-sm">
                  {summary.deliveryType === 'delivery' ? 'local_shipping' : 'storefront'}
                </span>
                {summary.deliveryType === 'delivery' ? 'Delivery' : 'Pickup'}
              </span>
            </div>

            <ul className="space-y-1.5">
              {summary.items.map((item, i) => (
                <li key={`${item.name}-${i}`} className="flex justify-between gap-3 text-xs">
                  <span className="font-bold truncate">
                    {item.name}
                    <span className="text-gray-400 dark:text-zinc-500 font-semibold"> ×{item.quantity}</span>
                  </span>
                  <span className="font-black text-gray-600 dark:text-zinc-300 shrink-0">
                    {money(item.price * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <div className="pt-2.5 border-t border-gray-100 dark:border-zinc-800 space-y-1 text-xs">
              {summary.discount > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold">
                  <span>Discount</span><span>−{money(summary.discount)}</span>
                </div>
              )}
              {summary.loyaltyDiscount > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400 font-bold">
                  <span>Loyalty</span><span>−{money(summary.loyaltyDiscount)}</span>
                </div>
              )}
              <div className="flex justify-between text-gray-400 dark:text-zinc-500 font-bold">
                <span>Delivery</span>
                <span>{summary.deliveryFee === 0 ? 'Free' : money(summary.deliveryFee)}</span>
              </div>
              <div className="flex justify-between text-sm font-black pt-1">
                <span>Total</span><span>{money(summary.total)}</span>
              </div>
              <p className="text-[10px] text-gray-400 dark:text-zinc-500 font-semibold pt-1 capitalize">
                Paying by {summary.paymentMethod}
              </p>
            </div>
          </section>
        )}

        {/* The timeline is the point of this screen, so it always renders —
            it used to be hidden entirely until the first status event arrived,
            which is exactly when a customer most wants to see progress. */}
        {!submitting && (
          <section className="bg-white dark:bg-zinc-900 rounded-[20px] border border-gray-100 dark:border-zinc-800 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-black text-[10px] uppercase tracking-wider text-gray-400 dark:text-zinc-500">Progress</h2>
              {elapsedMins !== null && (
                <span className="text-[10px] font-bold text-gray-400 dark:text-zinc-500">
                  {completedAt ? 'Took' : 'Running'} {elapsedMins < 60 ? `${elapsedMins} min` : `${Math.floor(elapsedMins / 60)}h ${elapsedMins % 60}m`}
                </span>
              )}
            </div>

            <ol className="space-y-0">
              {TIMELINE_STAGES.map((stage, i) => {
                const reachedAt = historyByStatus.get(stage);
                const isReached = !!reachedAt || (!failed && currentStageIdx >= 0 && i <= currentStageIdx);
                const isCurrent = stage === status;
                const isLast = i === TIMELINE_STAGES.length - 1;
                return (
                  <li key={stage} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${
                          isReached ? 'bg-[#1A1C1E] text-[#FFD23F] dark:bg-[#FFD23F] dark:text-zinc-950' : 'bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-400'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[11px] font-bold">{isReached ? 'check' : 'circle'}</span>
                      </span>
                      {!isLast && (
                        <span className={`w-0.5 flex-1 min-h-[20px] ${isReached && i < currentStageIdx ? 'bg-[#1A1C1E] dark:bg-[#FFD23F]' : 'bg-gray-100 dark:bg-zinc-800'}`} />
                      )}
                    </div>
                    <div className="pb-4 -mt-0.5 min-w-0">
                      <p className={`text-xs font-bold ${isReached ? '' : 'text-gray-400 dark:text-zinc-400'}`}>
                        {STAGE_LABELS[stage]}
                        {isCurrent && !failed && <span className="text-gray-400 dark:text-zinc-500 font-semibold"> · now</span>}
                      </p>
                      {reachedAt && (
                        <p className="text-[10px] text-gray-400 dark:text-zinc-500 font-semibold mt-0.5">{formatWhen(reachedAt)}</p>
                      )}
                      {stage === 'Preparing' && isCurrent && processingStage && (
                        <p className="text-[11px] font-bold mt-1 inline-flex items-center gap-1 bg-[#FFD23F]/20 px-2 py-0.5 rounded-full">
                          {processingStage}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
              {failed && (
                <li className="flex gap-3">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-rose-500 text-white">
                    <span className="material-symbols-outlined text-[11px] font-bold">close</span>
                  </span>
                  <div className="-mt-0.5">
                    <p className="text-xs font-bold text-rose-600 dark:text-rose-400">{status}</p>
                    {historyByStatus.get(status) && (
                      <p className="text-[10px] text-gray-400 dark:text-zinc-500 font-semibold mt-0.5">
                        {formatWhen(historyByStatus.get(status)!)}
                      </p>
                    )}
                  </div>
                </li>
              )}
            </ol>
          </section>
        )}

        {status === 'Rejected' && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-900 dark:text-rose-200 p-4 rounded-2xl text-xs space-y-2 shadow-sm">
            <h4 className="font-extrabold text-sm flex items-center gap-2">
              <span className="material-symbols-outlined text-base font-bold">warning</span>
              Why it was rejected
            </h4>
            <p className="font-semibold leading-relaxed">
              {merchantMessage.rejectionReason || 'The store did not give a reason. Message them below if you need one.'}
            </p>
          </div>
        )}

        {status === 'Changes Requested' && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-900 dark:text-amber-200 p-4 rounded-2xl text-xs space-y-3 shadow-sm">
            <h4 className="font-extrabold text-sm flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm font-bold">info</span>
              Review proposal
            </h4>
            {merchantMessage.changeRequestMessage && (
              <p className="bg-white dark:bg-zinc-900 p-3 rounded-xl border border-amber-100 dark:border-amber-800/60 leading-relaxed font-bold">
                “{merchantMessage.changeRequestMessage}”
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => cancel.onCancel()}
                disabled={busy || submitting}
                className="flex-1 py-3 bg-white dark:bg-zinc-900 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-50 text-rose-600 dark:text-rose-400 font-extrabold rounded-xl transition cursor-pointer uppercase tracking-wider text-xs disabled:opacity-60"
              >
                Cancel order
              </button>
              <button
                onClick={onApproveChanges}
                disabled={busy}
                className="flex-1 py-3 bg-[#1A1C1E] hover:bg-black text-[#FFD23F] font-black rounded-xl transition cursor-pointer uppercase tracking-wider text-xs disabled:opacity-60"
              >
                {busy ? 'Approving…' : 'Approve'}
              </button>
            </div>
          </div>
        )}

        {cancel.error && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-rose-800 dark:text-rose-200 p-4 rounded-2xl text-xs shadow-sm flex items-start gap-2.5">
            <span className="material-symbols-outlined text-sm font-bold shrink-0 mt-0.5">error</span>
            <div className="flex-1">
              <h4 className="font-extrabold text-sm">Couldn’t cancel order</h4>
              <p className="leading-relaxed mt-0.5">{cancel.error}</p>
            </div>
            <button onClick={cancel.clearError} aria-label="Dismiss" className="shrink-0 cursor-pointer text-rose-400 hover:text-rose-600">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        )}

        {/* Contacting the store and cancelling are the two things a customer
            actually comes here to do, so they sit together. */}
        <div className="flex gap-2">
          {store?.phone && (
            <a
              href={`https://wa.me/${String(store.phone).replace(/\D/g, '')}?text=${encodeURIComponent(
                `Hi, I'm checking on my order${order.number ? ` #${order.number}` : ''} at ${store.business_name}. Current status: ${status}${processingStage ? ` (${processingStage})` : ''}. Could you give me an update?`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-[#25D366]/10 border border-[#25D366]/30 text-[#128C4A] dark:text-[#25D366] font-black text-xs uppercase tracking-wide active-scale"
            >
              <span className="material-symbols-outlined text-base">chat</span>
              Message store
            </a>
          )}
          {canCancel && (
            <button
              onClick={() => { cancel.clearError(); cancel.setReason(''); cancel.setShowConfirm(true); }}
              className="flex-1 py-3 bg-white dark:bg-zinc-900 border border-rose-200 dark:border-rose-800/60 hover:bg-rose-50 text-rose-600 dark:text-rose-400 font-extrabold rounded-2xl transition cursor-pointer uppercase tracking-wider text-xs flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-sm">cancel</span>
              Cancel order
            </button>
          )}
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onViewStore}
            className="flex-1 py-3.5 bg-[#1A1C1E] text-[#FFD23F] font-black rounded-2xl flex items-center justify-center gap-2 active:scale-98 transition shadow-sm text-xs uppercase tracking-wider cursor-pointer hover:bg-black"
          >
            Back to store
          </button>
          <button
            onClick={onViewOrders}
            className="flex-1 py-3.5 bg-white dark:bg-zinc-900 border border-gray-100 dark:border-zinc-800 font-extrabold rounded-2xl text-xs uppercase tracking-wider hover:bg-gray-50 dark:hover:bg-zinc-800 cursor-pointer"
          >
            All orders
          </button>
        </div>

        {onInstall && (
          <button
            onClick={onInstall}
            className="w-full py-3 bg-[#FFD23F]/10 border border-[#FFD23F]/20 font-extrabold rounded-2xl flex items-center justify-between px-5 hover:bg-[#FFD23F]/15 cursor-pointer text-xs"
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[#FFD23F] text-lg font-black">download</span>
              Install the app
            </span>
            <span className="material-symbols-outlined text-gray-400 text-lg">chevron_right</span>
          </button>
        )}
      </main>

      {cancel.showConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4" onClick={() => cancel.setShowConfirm(false)}>
          <div className="bg-white dark:bg-zinc-900 rounded-3xl p-6 w-full max-w-sm space-y-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="text-center space-y-1.5">
              <span className="material-symbols-outlined text-3xl text-rose-500">warning</span>
              <h3 className="font-black text-base">Cancel this order?</h3>
              <p className="text-xs text-gray-500 dark:text-zinc-400 leading-relaxed">
                This can’t be undone. The store is notified immediately and won’t prepare it.
                {summary && summary.paymentMethod !== 'cash' &&
                  ' If you already paid online, contact the store to arrange a refund.'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-gray-400 dark:text-zinc-500 uppercase tracking-wider px-0.5">Reason (optional)</label>
              <div className="flex flex-wrap gap-1.5">
                {cancel.reasons.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => cancel.setReason(cancel.reason === r ? '' : r)}
                    className={`px-3 py-1.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                      cancel.reason === r
                        ? 'bg-[#1A1C1E] text-white border-[#1A1C1E] dark:bg-[#FFD23F] dark:text-zinc-950 dark:border-[#FFD23F]'
                        : 'bg-white dark:bg-zinc-900 text-gray-500 dark:text-zinc-400 border-gray-200 dark:border-zinc-700 hover:bg-gray-50'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => cancel.setShowConfirm(false)}
                className="flex-1 py-3 bg-gray-100 dark:bg-zinc-800 font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer"
              >
                Keep order
              </button>
              <button
                onClick={() => { cancel.setShowConfirm(false); cancel.onCancel(cancel.reason); }}
                disabled={busy}
                className="flex-1 py-3 bg-rose-500 hover:bg-rose-600 text-white font-bold rounded-xl text-xs uppercase tracking-wider cursor-pointer disabled:opacity-60"
              >
                {busy ? 'Cancelling…' : 'Yes, cancel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
