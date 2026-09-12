import { useState } from 'react';
import { supabase } from '../supabase';

/**
 * Read-only guest tracking from any device.
 *
 * No account is required. We ask for both the order code and the phone number
 * used at checkout so an order code by itself cannot enumerate customer data.
 * This route never returns or recreates the private order token; cancel/approve
 * actions still require the original device token.
 */
export default function TrackOrderLookup({
  store,
  onClose,
  onOpenOrder,
}: {
  store: any;
  onClose: () => void;
  onOpenOrder: (order: any) => void;
}) {
  const [phone, setPhone] = useState('');
  const [orderCode, setOrderCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const canSearch = phone.replace(/\D/g, '').length >= 10 && orderCode.trim().length > 0;

  const run = async () => {
    setError('');
    if (!canSearch) return;
    if (!store?.id) {
      setError("Couldn't identify this store — try rescanning the QR code.");
      return;
    }

    setLoading(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('get_guest_order_by_code', {
        p_store_id: store.id,
        p_order_number: orderCode.trim().toUpperCase(),
        p_customer_phone: phone.trim(),
      });
      if (rpcError) throw rpcError;
      if (!data) {
        setError('No order matched that phone number and order code at this store.');
      } else {
        onOpenOrder(data);
      }
    } catch {
      setError("Couldn't look that up right now — check the details and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 px-0 sm:px-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-white dark:bg-zinc-900 rounded-t-3xl sm:rounded-3xl p-5 pb-8 sm:pb-5"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-black text-[#1A1C1E] dark:text-zinc-100">Track an Order</h3>
          <button onClick={onClose} aria-label="Close" className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-zinc-400 mb-4">
          No account needed — enter the phone number used at checkout and your order code.
        </p>

        <div className="space-y-3">
          <input
            value={phone}
            onChange={e => setPhone(e.target.value.replace(/[^0-9+]/g, ''))}
            placeholder="Phone number, e.g. 08012345678"
            inputMode="tel"
            aria-label="Phone number used at checkout"
            autoFocus
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 text-sm font-bold placeholder:font-medium placeholder:text-gray-300 focus:outline-none focus:border-[#1A1C1E]"
          />

          <input
            value={orderCode}
            onChange={e => setOrderCode(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canSearch && !loading) run(); }}
            placeholder="Order code, e.g. SF-4821"
            inputMode="text"
            aria-label="Order code"
            className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 text-sm font-bold placeholder:font-medium placeholder:text-gray-300 focus:outline-none focus:border-[#1A1C1E]"
          />
        </div>

        <p className="text-[10px] text-gray-400 dark:text-zinc-500 font-semibold mt-2 leading-relaxed">
          Tracking from another device is read-only. Cancelling or approving changes still requires the private order key saved on the device that placed the order.
        </p>

        {error && <p className="text-xs text-red-500 font-semibold mt-2">{error}</p>}

        <button
          onClick={run}
          disabled={!canSearch || loading}
          className="w-full mt-4 py-3.5 rounded-xl bg-[#1A1C1E] text-white font-black text-xs uppercase tracking-wide disabled:opacity-40"
        >
          {loading ? 'Looking up…' : 'Track Order'}
        </button>
      </div>
    </div>
  );
}
