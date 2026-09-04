import { useState } from 'react';
import { supabase } from '../supabase';
import { saveOrderAccessToken } from '../lib/orderTokens';

/**
 * Look up an order without an account, by phone number or order code.
 *
 * This is what lets someone track an order from a different device to the one
 * that placed it. The search mode, the field, the error and the candidate list
 * are all local to the sheet — they used to be six pieces of state on the root
 * App component.
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
  const [mode, setMode] = useState<'phone' | 'code'>('phone');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const switchMode = (next: 'phone' | 'code') => {
    setMode(next);
    setError('');
    setResults([]);
  };

  const run = async () => {
    const query = value.trim();
    setError('');
    if (!query) return;
    if (!store?.id) {
      setError("Couldn't identify this store — try rescanning the QR code.");
      return;
    }
    setLoading(true);
    try {
      if (mode === 'phone') {
        const normalized = query.replace(/\D/g, '');
        const { data, error: rpcError } = await supabase.rpc('get_customer_orders', { p_customer_phone: normalized });
        if (rpcError) throw rpcError;
        const matches = (data || []).filter((o: any) => o.store_id === store.id);
        // Keep the tokens so this device can track these orders from now on.
        for (const o of matches) {
          if (o.id && o.access_token) saveOrderAccessToken(o.id, o.access_token);
        }
        if (matches.length === 0) setError('No orders found for that phone number at this store.');
        else if (matches.length === 1) onOpenOrder(matches[0]);
        else setResults(matches);
      } else {
        const { data, error: rpcError } = await supabase.rpc('get_order_by_number', {
          p_store_id: store.id,
          p_order_number: query.toUpperCase(),
        });
        if (rpcError) throw rpcError;
        if (!data) setError('No order found with that code at this store.');
        else onOpenOrder(data);
      }
    } catch {
      setError("Couldn't look that up right now — check your connection and try again.");
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
          No account needed — just your phone number or order code.
        </p>

        <div className="flex bg-gray-100 dark:bg-zinc-800 rounded-xl p-1 mb-3">
          {(['phone', 'code'] as const).map(m => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-2 rounded-lg text-xs font-black transition ${
                mode === m ? 'bg-white dark:bg-zinc-900 shadow-sm text-[#1A1C1E] dark:text-zinc-100' : 'text-gray-400'
              }`}
            >
              {m === 'phone' ? 'Phone Number' : 'Order Code'}
            </button>
          ))}
        </div>

        <input
          value={value}
          onChange={e => setValue(mode === 'phone' ? e.target.value.replace(/[^0-9+]/g, '') : e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && value.trim() && !loading) run(); }}
          placeholder={mode === 'phone' ? 'e.g. 08012345678' : 'e.g. SF-4821'}
          inputMode={mode === 'phone' ? 'tel' : 'text'}
          aria-label={mode === 'phone' ? 'Phone number' : 'Order code'}
          autoFocus
          className="w-full px-4 py-3 rounded-xl border border-gray-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 text-sm font-bold placeholder:font-medium placeholder:text-gray-300 focus:outline-none focus:border-[#1A1C1E]"
        />

        {error && <p className="text-xs text-red-500 font-semibold mt-2">{error}</p>}

        {results.length > 0 && (
          <div className="mt-3 space-y-2">
            <p className="text-[11px] text-gray-500 dark:text-zinc-400 font-bold">Multiple orders found — pick one:</p>
            {results.map(o => (
              <button
                key={o.id}
                onClick={() => onOpenOrder(o)}
                className="w-full flex items-center justify-between p-3 rounded-xl border border-gray-100 dark:border-zinc-800 bg-gray-50 dark:bg-zinc-950 text-left"
              >
                <span className="text-xs font-black text-[#1A1C1E] dark:text-zinc-100">#{o.order_number}</span>
                <span className="text-[11px] text-gray-400 font-bold">{o.status}</span>
              </button>
            ))}
          </div>
        )}

        <button
          onClick={run}
          disabled={!value.trim() || loading}
          className="w-full mt-4 py-3.5 rounded-xl bg-[#1A1C1E] text-white font-black text-xs uppercase tracking-wide disabled:opacity-40"
        >
          {loading ? 'Looking up…' : 'Track Order'}
        </button>
      </div>
    </div>
  );
}
