import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabase';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';
import { subscribeUserToPush } from '../utils/pushNotifications';

type LaundryOffering = {
  id: string;
  name: string;
  pricing: string;
  price: number;
  turnaround?: string;
  garmentPrices: Record<string, number>;
};

type LaundryOrderResult = {
  id: string;
  access_token: string;
  order_number: string;
  status: string;
  workflow_stage: string;
  subtotal: number;
  total: number;
  created_at: string;
  store_id: string;
  store_name: string;
  customer_name: string;
  customer_phone: string;
  notes: string;
  business_type: 'laundry';
  order_kind: 'service';
  order_items: Array<{ item_name: string; quantity: number; price: number; subtotal: number }>;
};

interface Props {
  store: any;
  onOrderPlaced: (order: LaundryOrderResult) => void;
  onOpenOrders: () => void;
}

function uniqueNames(values: unknown[]): string[] {
  const seen = new Set<string>();
  return values.reduce<string[]>((result, value) => {
    const name = String(value || '').trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      result.push(name);
    }
    return result;
  }, []);
}

function normalizeOffering(raw: any): LaundryOffering {
  return {
    id: String(raw?.id || ''),
    name: String(raw?.name || 'Laundry'),
    pricing: String(raw?.pricing || raw?.servicePricing || 'per_piece').toLowerCase(),
    price: Math.max(0, Number(raw?.price ?? raw?.sellingPrice ?? 0) || 0),
    turnaround: String(raw?.turnaround || ''),
    garmentPrices: raw?.garmentPrices && typeof raw.garmentPrices === 'object' ? raw.garmentPrices : {},
  };
}

function caseInsensitivePrice(record: Record<string, unknown> | undefined, name: string): number | null {
  if (!record) return null;
  const pair = Object.entries(record).find(([key]) => key.toLowerCase() === name.toLowerCase());
  if (!pair) return null;
  const value = Number(pair[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export default function LaundryStorefront({ store, onOrderPlaced, onOpenOrders }: Props) {
  const data = store?.data || {};
  const template = data.businessTemplate || data.business_template || {};
  const pricing = data.laundryPricing || template.laundryPricing || {};
  const offerings = useMemo(() => {
    const configured = Array.isArray(template.offerings) ? template.offerings : [];
    const products = Array.isArray(data.products) ? data.products.filter((item: any) => item?.isService === true) : [];
    return (configured.length ? configured : products)
      .filter((item: any) => item && item.discontinued !== true && item.enabled !== false && item.active !== false)
      .map(normalizeOffering)
      .filter((item: LaundryOffering) => item.id);
  }, [data.products, template.offerings]);
  const garmentTypes = useMemo(() => uniqueNames(Array.isArray(pricing.garmentTypes) ? pricing.garmentTypes : []), [pricing.garmentTypes]);
  const [selectedServiceId, setSelectedServiceId] = useState(() => offerings[0]?.id || '');
  const selected = offerings.find((item: LaundryOffering) => item.id === selectedServiceId) || offerings[0] || null;
  const [view, setView] = useState<'record' | 'prices'>('record');
  const [clothes, setClothes] = useState<Record<string, number>>({});
  const [name, setName] = useState(() => safeGetItem('storeflow_saved_checkout_name') || '');
  const [phone, setPhone] = useState(() => safeGetItem('storeflow_saved_checkout_phone') || '');
  const [address, setAddress] = useState(() => safeGetItem('storeflow_pref_address') || '');
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [receipt, setReceipt] = useState<LaundryOrderResult | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<'cart' | 'checkout'>('cart');

  useEffect(() => {
    if (!offerings.length) {
      setSelectedServiceId('');
      return;
    }
    if (!offerings.some((item: LaundryOffering) => item.id === selectedServiceId)) {
      setSelectedServiceId(offerings[0].id);
      setClothes({});
    }
  }, [offerings, selectedServiceId]);

  const matrixRow = selected && pricing.matrix && typeof pricing.matrix === 'object'
    ? pricing.matrix[String(selected.id)] as Record<string, unknown> | undefined
    : undefined;
  const unitPrice = (garment: string) => {
    if (!selected) return 0;
    return caseInsensitivePrice(selected.garmentPrices, garment)
      ?? caseInsensitivePrice(matrixRow, garment)
      ?? (selected.pricing === 'per_piece' ? selected.price : 0);
  };
  const lines = garmentTypes
    .map(garment => ({ garment, quantity: Number(clothes[garment] || 0), price: unitPrice(garment) }))
    .filter(line => line.quantity > 0);
  const pieces = lines.reduce((sum, line) => sum + line.quantity, 0);
  const pricedTotal = lines.reduce((sum, line) => sum + line.quantity * line.price, 0);
  const total = selected?.pricing === 'per_piece' ? pricedTotal : selected?.pricing === 'fixed' ? selected.price : 0;
  const allSelectedLinesPriced = lines.every(line => line.price > 0);

  const adjust = (garment: string, delta: number) => {
    setClothes(current => ({ ...current, [garment]: Math.max(0, Number(current[garment] || 0) + delta) }));
    setMessage('');
  };

  const submit = async () => {
    if (!name.trim() || !phone.trim() || !address.trim()) {
      setMessage('Enter your name, phone number and address.');
      return;
    }
    if (!pieces) {
      setMessage('Tap + beside at least one clothing item.');
      return;
    }
    setSubmitting(true);
    setMessage('');
    try {
      const garments = lines.map(line => ({ garment_type: line.garment, quantity: line.quantity }));
      const storeKey = String(store?.store_id || data.storeId || data.store_id || store?.id || '');
      const { data: result, error } = await supabase.rpc('customer_place_laundry_order', {
        p_store_key: storeKey,
        p_customer_name: name.trim(),
        p_customer_phone: phone.trim(),
        p_customer_address: address.trim(),
        p_service_id: selected?.id || '',
        p_garments: garments,
        p_notes: notes.trim(),
        p_fulfillment: fulfillment,
      });
      if (error) throw error;
      const placed = result as LaundryOrderResult;
      safeSetItem('storeflow_saved_checkout_name', name.trim());
      safeSetItem('storeflow_saved_checkout_phone', phone.trim());
      safeSetItem('storeflow_pref_address', address.trim());
      // A laundry order can be the customer's first checkout in StoreFlow.
      // Bind this device to the submitted phone now so status updates continue
      // to arrive after the app has been closed.
      subscribeUserToPush(phone.trim()).catch(error => console.warn('[Push] Laundry checkout subscription failed:', error));
      onOrderPlaced(placed);
      setCartOpen(false);
      setCheckoutStep('cart');
      setReceipt(placed);
    } catch (error: any) {
      setMessage(error?.message || 'The laundry order could not be sent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!garmentTypes.length) {
    return (
      <section className="rounded-[28px] border border-gray-100 bg-white p-8 text-center shadow-sm">
        <span className="material-symbols-outlined text-4xl text-gray-300">dry_cleaning</span>
        <h2 className="mt-3 font-black">Laundry price list is not ready</h2>
        <p className="mt-1 text-xs font-medium text-gray-500">{store?.business_name || 'This laundry'} has not published its clothing list yet.</p>
      </section>
    );
  }

  if (receipt) {
    return (
      <section className="rounded-[28px] border border-emerald-100 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <span className="material-symbols-outlined text-3xl">check_circle</span>
        </div>
        <h2 className="mt-4 text-xl font-black">Laundry recorded</h2>
        <p className="mt-1 text-sm text-gray-500">Receipt <b>#{receipt.order_number}</b> is now with {receipt.store_name}.</p>
        <p className="mt-3 text-xs font-bold text-gray-500">{pieces} clothing item{pieces === 1 ? '' : 's'} · {receipt.total > 0 ? `₦${Number(receipt.total).toLocaleString()}` : 'Price to be confirmed'}</p>
        <button type="button" onClick={onOpenOrders} className="mt-5 w-full rounded-2xl bg-[#1A1C1E] px-4 py-3.5 text-sm font-black text-[#FFD23F]">View in Order History</button>
        <button type="button" onClick={() => { setReceipt(null); setClothes({}); setNotes(''); }} className="mt-2 w-full rounded-2xl border border-gray-200 px-4 py-3 text-xs font-black">Record another laundry</button>
      </section>
    );
  }

  const surface = 'border-gray-100 bg-white dark:border-zinc-800 dark:bg-zinc-900';
  const field = 'w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-[#1A1C1E] outline-none placeholder:text-gray-400 focus:border-[#FFD23F] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500';

  return (
    <section className="space-y-4 pb-24 text-[#1A1C1E] dark:text-zinc-100">
      <div className={`grid grid-cols-2 rounded-2xl border p-1 ${surface}`}>
        <button type="button" onClick={() => setView('record')} className={`rounded-xl px-3 py-3 text-xs font-black transition-colors ${view === 'record' ? 'bg-[#1A1C1E] text-[#FFD23F] dark:bg-[#FFD23F] dark:text-zinc-950' : 'text-gray-500 dark:text-zinc-400'}`}>Order Laundry</button>
        <button type="button" onClick={() => setView('prices')} className={`rounded-xl px-3 py-3 text-xs font-black transition-colors ${view === 'prices' ? 'bg-[#1A1C1E] text-[#FFD23F] dark:bg-[#FFD23F] dark:text-zinc-950' : 'text-gray-500 dark:text-zinc-400'}`}>Price List</button>
      </div>

      {offerings.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-[10px] font-black uppercase tracking-wider text-gray-400 dark:text-zinc-500">Choose treatment</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {offerings.map((offering: LaundryOffering) => (
              <button type="button" key={offering.id} onClick={() => { setSelectedServiceId(offering.id); setClothes({}); }} className={`shrink-0 rounded-2xl border px-4 py-3 text-left transition-colors ${selected?.id === offering.id ? 'border-[#FFD23F] bg-[#FFF7CC] text-zinc-950 dark:bg-[#FFD23F]/15 dark:text-[#FFD23F]' : 'border-gray-200 bg-white text-[#1A1C1E] dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100'}`}>
                <span className="block text-xs font-black">{offering.name}</span>
                {offering.turnaround && <span className={`mt-0.5 block text-[10px] ${selected?.id === offering.id ? 'text-zinc-600 dark:text-amber-200/70' : 'text-gray-500 dark:text-zinc-400'}`}>{offering.turnaround}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end justify-between gap-3 px-1">
        <div><h2 className="font-black">{view === 'prices' ? 'Laundry prices' : 'Choose your clothes'}</h2><p className="mt-0.5 text-[11px] text-gray-500 dark:text-zinc-400">{view === 'prices' ? `Prices from ${store?.business_name || 'this laundry'}` : 'Tap + to add an item to your cart.'}</p></div>
        {view === 'record' && pieces > 0 && <span className="rounded-full bg-[#FFD23F] px-3 py-1 text-[10px] font-black text-zinc-950">{pieces} in cart</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {garmentTypes.map(garment => {
          const quantity = Number(clothes[garment] || 0);
          const price = unitPrice(garment);
          return (
            <article key={garment} className={`flex min-h-40 flex-col rounded-2xl border p-3.5 ${surface}`}>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-zinc-800 dark:text-zinc-300"><span className="material-symbols-outlined text-xl">dry_cleaning</span></div>
              <div className="mt-3 min-w-0 flex-1"><h3 className="truncate text-sm font-black text-[#1A1C1E] dark:text-zinc-100">{garment}</h3><p className="mt-0.5 text-[10px] font-semibold text-gray-500 dark:text-zinc-400">{price > 0 ? `₦${price.toLocaleString()} each` : 'Price to be confirmed'}</p></div>
              {view === 'record' ? (
                <div className="mt-3 flex items-center justify-end">
                  {quantity > 0 ? (
                    <div className="flex items-center gap-2 rounded-full bg-[#1A1C1E] p-1 text-white shadow-md dark:bg-zinc-800">
                      <button type="button" onClick={() => adjust(garment, -1)} aria-label={`Remove one ${garment}`} className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white active:scale-95"><span className="material-symbols-outlined text-xs">remove</span></button>
                      <span className="min-w-4 text-center text-xs font-black">{quantity}</span>
                      <button type="button" onClick={() => adjust(garment, 1)} aria-label={`Add one ${garment}`} className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FFD23F] text-zinc-950 active:scale-95"><span className="material-symbols-outlined text-xs font-black">add</span></button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => adjust(garment, 1)} aria-label={`Add one ${garment}`} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FFD23F] text-zinc-950 shadow-sm active:scale-95"><span className="material-symbols-outlined text-sm font-black">add</span></button>
                  )}
                </div>
              ) : <p className="mt-3 text-sm font-black text-[#1A1C1E] dark:text-[#FFD23F]">{price > 0 ? `₦${price.toLocaleString()}` : 'Ask store'}</p>}
            </article>
          );
        })}
      </div>

      {view === 'record' && lines.length > 0 && createPortal(
        <button type="button" onClick={() => { setCheckoutStep('cart'); setCartOpen(true); }} className="fixed bottom-20 left-4 right-4 z-40 mx-auto flex max-w-2xl items-center justify-between rounded-full border border-white/5 bg-[#1A1C1E] px-6 py-4 text-white shadow-2xl active:scale-[0.98]">
          <span className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#FFD23F] font-mono text-[11px] font-black text-zinc-950">{pieces}</span><span className="text-sm font-black uppercase tracking-wider text-white">View Cart</span></span>
          <span className="flex items-center gap-1.5"><span className="text-sm font-black text-[#FFD23F]">{total > 0 && allSelectedLinesPriced ? `₦${total.toLocaleString()}` : 'Review order'}</span><span className="material-symbols-outlined text-lg font-bold text-[#FFD23F]">arrow_forward</span></span>
        </button>, document.body
      )}

      {cartOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm" onClick={() => setCartOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-2xl overflow-hidden rounded-t-3xl bg-white text-[#1A1C1E] shadow-2xl dark:bg-zinc-900 dark:text-zinc-100" onClick={event => event.stopPropagation()}>
            <div className="mx-auto mt-3 h-1 w-12 rounded-full bg-gray-200 dark:bg-zinc-700" />
            {checkoutStep === 'cart' ? (
              <div className="flex max-h-[84vh] flex-col p-6">
                <div className="flex items-center justify-between"><div><div className="flex items-center gap-3"><h2 className="text-lg font-black">My Cart ({pieces})</h2><button type="button" onClick={() => { setClothes({}); setCartOpen(false); }} className="text-xs font-bold text-red-600 dark:text-red-400">Clear All</button></div><p className="mt-1 text-xs text-gray-400 dark:text-zinc-400">{selected?.name || 'Laundry service'}</p></div><button type="button" onClick={() => setCartOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 text-[#1A1C1E] dark:bg-zinc-800 dark:text-white"><span className="material-symbols-outlined text-lg">close</span></button></div>
                <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1 py-2">
                  {lines.map(line => (
                    <div key={line.garment} className="flex items-center gap-4 border-b border-gray-100 pb-4 last:border-b-0 dark:border-zinc-800">
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-gray-50 text-gray-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"><span className="material-symbols-outlined">dry_cleaning</span></div>
                      <div className="min-w-0 flex-1 text-left"><h3 className="truncate text-sm font-bold">{line.garment}</h3><p className="mt-0.5 text-xs font-semibold text-gray-400 dark:text-zinc-400">{line.price > 0 ? `₦${line.price.toLocaleString()} each` : 'Price to be confirmed'}</p></div>
                      <div className="flex shrink-0 items-center gap-3 rounded-full border border-gray-100 bg-gray-50 p-1 dark:border-zinc-700 dark:bg-zinc-800"><button type="button" onClick={() => adjust(line.garment, -1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-100 bg-white text-[#1A1C1E] shadow-sm dark:border-zinc-600 dark:bg-zinc-700 dark:text-white"><span className="material-symbols-outlined text-sm font-bold">remove</span></button><span className="w-4 text-center text-sm font-black">{line.quantity}</span><button type="button" onClick={() => adjust(line.garment, 1)} className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1A1C1E] text-[#FFD23F] shadow-sm dark:bg-black"><span className="material-symbols-outlined text-sm font-black">add</span></button></div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 border-t border-gray-100 pt-4 dark:border-zinc-800"><div className="mb-2 flex justify-between text-xs font-bold text-gray-400"><span>Subtotal</span><span>{total > 0 && allSelectedLinesPriced ? `₦${total.toLocaleString()}` : 'To be confirmed'}</span></div><div className="mb-3 flex justify-between text-xs font-bold text-gray-400"><span>Delivery Fee</span><span>{fulfillment === 'delivery' ? 'Confirmed at checkout' : 'FREE'}</span></div><div className="mb-5 flex items-center justify-between border-t border-gray-100 pt-3 text-base font-black dark:border-zinc-800"><span>Total</span><span>{total > 0 && allSelectedLinesPriced ? `₦${total.toLocaleString()}` : 'To be confirmed'}</span></div><button type="button" onClick={() => setCheckoutStep('checkout')} className="w-full rounded-full bg-black py-4 text-xs font-black uppercase tracking-wider text-[#FFD23F]">Continue to Checkout</button></div>
              </div>
            ) : (
              <div className="max-h-[84vh] overflow-y-auto p-5">
                <div className="flex items-center justify-between"><button type="button" onClick={() => setCheckoutStep('cart')} className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800"><span className="material-symbols-outlined text-lg">arrow_back</span></button><h2 className="font-black">Checkout Details</h2><button type="button" onClick={() => setCartOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 dark:bg-zinc-800"><span className="material-symbols-outlined text-lg">close</span></button></div>
                <div className="mt-5 space-y-3">
                  <input aria-label="Customer name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Customer name" className={field} />
                  <input aria-label="Phone number" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value.replace(/[^0-9+]/g, ''))} inputMode="tel" placeholder="Phone number" className={field} />
                  <textarea aria-label="Address" autoComplete="street-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Address" rows={2} className={`${field} resize-none`} />
                  <div className="grid grid-cols-2 gap-2">{(['pickup', 'delivery'] as const).map(option => <button type="button" key={option} onClick={() => setFulfillment(option)} className={`rounded-2xl border px-3 py-3 text-xs font-black capitalize ${fulfillment === option ? 'border-[#FFD23F] bg-[#FFF7CC] text-zinc-950 dark:bg-[#FFD23F] dark:text-zinc-950' : 'border-gray-200 dark:border-zinc-700 dark:text-zinc-200'}`}>{option}</button>)}</div>
                  <textarea aria-label="Special instructions" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Special instructions (optional)" rows={3} className={`${field} resize-none`} />
                </div>
                <div className="mt-5 rounded-2xl bg-gray-50 p-4 dark:bg-zinc-800"><div className="flex items-center justify-between"><span className="text-sm font-bold">Estimated total</span><span className="text-lg font-black text-[#1A1C1E] dark:text-[#FFD23F]">{total > 0 && allSelectedLinesPriced ? `₦${total.toLocaleString()}` : 'To be confirmed'}</span></div>{message && <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">{message}</p>}<button type="button" onClick={submit} disabled={submitting} className="mt-4 w-full rounded-full bg-[#FFD23F] py-4 text-sm font-black text-zinc-950 disabled:opacity-50">{submitting ? 'Sending order…' : 'Place Laundry Order'}</button></div>
              </div>
            )}
          </div>
        </div>, document.body
      )}
    </section>
  );
}
