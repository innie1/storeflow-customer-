import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabase';
import { safeGetItem, safeSetItem } from '../utils/safeStorage';

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
      onOrderPlaced(placed);
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

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-gray-100">
        <button type="button" onClick={() => setView('record')} className={`rounded-xl px-3 py-3 text-xs font-black ${view === 'record' ? 'bg-[#1A1C1E] text-[#FFD23F]' : 'text-gray-500'}`}>Record Laundry</button>
        <button type="button" onClick={() => setView('prices')} className={`rounded-xl px-3 py-3 text-xs font-black ${view === 'prices' ? 'bg-[#1A1C1E] text-[#FFD23F]' : 'text-gray-500'}`}>Price List</button>
      </div>

      {offerings.length > 0 && (
        <div className="space-y-2">
          <p className="px-1 text-[10px] font-black uppercase tracking-wider text-gray-400">Laundry treatment</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {offerings.map((offering: LaundryOffering) => (
              <button type="button" key={offering.id} onClick={() => setSelectedServiceId(offering.id)} className={`shrink-0 rounded-2xl border px-4 py-3 text-left ${selected?.id === offering.id ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200 bg-white'}`}>
                <span className="block text-xs font-black">{offering.name}</span>
                {offering.turnaround && <span className="mt-0.5 block text-[10px] text-gray-500">{offering.turnaround}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {view === 'prices' ? (
        <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 p-4">
            <h2 className="font-black">{selected?.name || 'Laundry'} Price List</h2>
            <p className="mt-1 text-xs text-gray-500">Prices published by {store?.business_name || 'this laundry'}.</p>
          </div>
          <div className="divide-y divide-gray-100">
            {garmentTypes.map(garment => {
              const price = unitPrice(garment);
              return <div key={garment} className="flex items-center justify-between px-4 py-3.5 text-sm"><span className="font-bold">{garment}</span><span className="font-black">{price > 0 ? `₦${price.toLocaleString()}` : 'Price to be confirmed'}</span></div>;
            })}
          </div>
        </div>
      ) : (
        <>
          {!selected && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs font-semibold text-amber-900">
              You can record your clothes now. {store?.business_name || 'The laundry'} will confirm the price because no treatment prices have been published yet.
            </div>
          )}
          <div className="rounded-[24px] border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div><h2 className="font-black">Your clothes</h2><p className="mt-1 text-xs text-gray-500">Tap + once for every item.</p></div>
              <span className="rounded-full bg-[#FFD23F]/25 px-3 py-1 text-xs font-black">{pieces} items</span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {garmentTypes.map(garment => {
                const quantity = Number(clothes[garment] || 0);
                const price = unitPrice(garment);
                return (
                  <div key={garment} className={`rounded-2xl border p-3 ${quantity ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-100 bg-gray-50'}`}>
                    <div className="flex items-start justify-between gap-2"><div><p className="text-sm font-black">{garment}</p><p className="text-[10px] text-gray-500">{price > 0 ? `₦${price.toLocaleString()} each` : 'Price to be confirmed'}</p></div>{quantity > 0 && price > 0 && <span className="text-xs font-black">₦{(quantity * price).toLocaleString()}</span>}</div>
                    <div className="mt-3 flex items-center justify-between">
                      <button type="button" onClick={() => adjust(garment, -1)} aria-label={`Remove one ${garment}`} className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white"><span className="material-symbols-outlined text-base">remove</span></button>
                      <span className="font-black">{quantity}</span>
                      <button type="button" onClick={() => adjust(garment, 1)} aria-label={`Add one ${garment}`} className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1A1C1E] text-[#FFD23F]"><span className="material-symbols-outlined text-base">add</span></button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {lines.length > 0 && (
            <div className="overflow-hidden rounded-[24px] border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <div><h2 className="text-sm font-black">Your laundry basket</h2><p className="text-[10px] text-gray-500">Check your clothes before sending.</p></div>
                <button type="button" onClick={() => setClothes({})} className="text-[10px] font-black text-red-600">Clear all</button>
              </div>
              <div className="divide-y divide-gray-100">
                {lines.map(line => (
                  <div key={line.garment} className="flex items-center gap-3 px-4 py-3">
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-black">{line.garment}</span><span className="text-[10px] text-gray-500">{line.quantity} × {line.price > 0 ? `₦${line.price.toLocaleString()}` : 'price to be confirmed'}</span></span>
                    <span className="text-xs font-black">{line.price > 0 ? `₦${(line.quantity * line.price).toLocaleString()}` : '—'}</span>
                    <button type="button" onClick={() => setClothes(current => ({ ...current, [line.garment]: 0 }))} aria-label={`Delete ${line.garment} from basket`} className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600"><span className="material-symbols-outlined text-base">delete</span></button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-[24px] border border-gray-100 bg-white p-4 shadow-sm">
            <h2 className="font-black">Your details</h2>
            <input aria-label="Customer name" autoComplete="name" value={name} onChange={event => setName(event.target.value)} placeholder="Customer name" className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#1A1C1E]" />
            <input aria-label="Phone number" autoComplete="tel" value={phone} onChange={event => setPhone(event.target.value.replace(/[^0-9+]/g, ''))} inputMode="tel" placeholder="Phone number" className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#1A1C1E]" />
            <textarea aria-label="Address" autoComplete="street-address" value={address} onChange={event => setAddress(event.target.value)} placeholder="Address" rows={2} className="w-full resize-none rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#1A1C1E]" />
            <div className="grid grid-cols-2 gap-2">
              {(['pickup', 'delivery'] as const).map(option => <button type="button" key={option} onClick={() => setFulfillment(option)} className={`rounded-2xl border px-3 py-3 text-xs font-black capitalize ${fulfillment === option ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200'}`}>{option}</button>)}
            </div>
            <textarea aria-label="Special instructions" value={notes} onChange={event => setNotes(event.target.value)} placeholder="Special instructions (optional)" rows={3} className="w-full resize-none rounded-2xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-[#1A1C1E]" />
          </div>

          <div className="rounded-[24px] bg-[#1A1C1E] p-4 text-white shadow-sm">
            <div className="flex items-center justify-between"><span className="text-sm font-bold">Estimated total</span><span className="text-lg font-black text-[#FFD23F]">{total > 0 && allSelectedLinesPriced ? `₦${total.toLocaleString()}` : 'To be confirmed'}</span></div>
            <p className="mt-1 text-[10px] text-gray-300">The merchant receives this as a real laundry order and can update its status.</p>
            {message && <p className="mt-3 rounded-xl bg-white/10 p-3 text-xs font-semibold text-[#FFD23F]">{message}</p>}
            <button type="button" onClick={submit} disabled={submitting} className="mt-4 w-full rounded-2xl bg-[#FFD23F] px-4 py-3.5 text-sm font-black text-[#1A1C1E] disabled:opacity-50">{submitting ? 'Recording laundry…' : 'Record My Laundry'}</button>
          </div>
        </>
      )}
    </section>
  );
}
