import { useEffect, useMemo, useState } from 'react';
import { Camera, Check, ChevronLeft, FileUp, MapPin, Minus, Plus, Truck, Upload } from 'lucide-react';
import { supabase } from '../supabase';
import { parseRoute } from '../router';

type Offering = {
  id: string;
  name: string;
  description?: string;
  price?: number;
  sellingPrice?: number;
  pricing?: string;
  icon?: string;
  discontinued?: boolean;
  enabled?: boolean;
  active?: boolean;
  status?: string;
};

type StoreRecord = {
  id: string;
  business_name?: string;
  phone?: string;
  logo?: string;
  data?: any;
};

type ClothingLine = { name: string; quantity: number };

const SERVICE_TYPES = new Set([
  'laundry', 'barber', 'salon', 'tailoring', 'repair', 'printing', 'cyber_cafe',
  'car_wash', 'photography', 'cleaning', 'spa', 'games', 'gaming', 'games_entertainment',
]);

const DEFAULT_CLOTHES = ['Shirts', 'Trousers', 'Shorts', 'Native', 'Dresses', 'Jackets', 'Duvets', 'Bedsheets'];

function businessType(store: StoreRecord) {
  return String(
    store.data?.businessTemplate?.type || store.data?.storeType || store.data?.businessType || '',
  ).toLowerCase();
}

function isEnabledOffering(o: Offering) {
  return o && o.discontinued !== true && o.enabled !== false && o.active !== false && o.status !== 'inactive';
}

function readClothingOptions(store: StoreRecord): string[] {
  const template = store.data?.businessTemplate || {};
  const values = template.clothingTypes || template.clothingItems || template.config?.clothingTypes;
  return Array.isArray(values) && values.length ? values.map((v: any) => typeof v === 'string' ? v : v.name).filter(Boolean) : DEFAULT_CLOTHES;
}

export default function ServiceBusinessExperience() {
  const route = parseRoute();
  const [store, setStore] = useState<StoreRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(route.storeId));
  const [selected, setSelected] = useState<Offering | null>(null);
  const [clothes, setClothes] = useState<ClothingLine[]>([]);
  const [notes, setNotes] = useState('');
  const [fulfillment, setFulfillment] = useState<'pickup' | 'delivery'>('pickup');
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!route.storeId) { setLoading(false); return; }
      const { data } = await supabase
        .from('stores')
        .select('id,business_name,phone,logo,data')
        .eq('id', route.storeId)
        .maybeSingle();
      if (!cancelled) {
        setStore(data as StoreRecord | null);
        setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [route.storeId]);

  const type = store ? businessType(store) : '';
  const isServiceStore = SERVICE_TYPES.has(type) || store?.data?.businessTemplate?.modes?.includes?.('services');
  const template = store?.data?.businessTemplate || {};
  const offerings = useMemo<Offering[]>(() => {
    const configured = Array.isArray(template.offerings) ? template.offerings : [];
    return configured.filter(isEnabledOffering);
  }, [template]);
  const clothingOptions = useMemo(() => readClothingOptions(store || { data: {} }), [store]);
  const isLaundry = type === 'laundry';
  const isGaming = type === 'games' || type === 'gaming' || type === 'games_entertainment';
  const totalClothes = clothes.reduce((sum, line) => sum + line.quantity, 0);

  if (!route.storeId || !isServiceStore || (!loading && !store)) return null;
  if (loading) return null;

  const updateClothing = (name: string, delta: number) => {
    setClothes(prev => {
      const existing = prev.find(x => x.name === name);
      if (!existing && delta > 0) return [...prev, { name, quantity: 1 }];
      return prev.map(x => x.name === name ? { ...x, quantity: Math.max(0, x.quantity + delta) : x)
        .filter(x => x.quantity > 0);
    });
  };

  const submitRequest = async () => {
    if (!store || !selected) return;
    setSubmitting(true);
    setMessage('');

    const request = {
      kind: 'service_request',
      business_type: type,
      service_id: selected.id,
      service_name: selected.name,
      clothing: clothes,
      total_clothes: totalClothes,
      fulfillment,
      notes: notes.trim(),
      reference_image_name: referenceImage?.name || null,
      attachment_name: attachment?.name || null,
      created_at: new Date().toISOString(),
    };

    const customerName = localStorage.getItem('storeflow_saved_checkout_name') || 'Customer';
    const customerPhone = localStorage.getItem('storeflow_saved_checkout_phone') || '';
    const orderNumber = `SVC-${Date.now().toString(36).toUpperCase()}`;

    // Service requests use the existing orders channel. The detailed request
    // stays in notes so merchants can see the structured job even when there
    // is no inventory product row behind the service.
    const { error } = await supabase.from('orders').insert({
      store_id: store.id,
      order_number: orderNumber,
      customer_name: customerName,
      customer_phone: customerPhone,
      status: 'Pending',
      subtotal: Number(selected.price ?? selected.sellingPrice ?? 0),
      total: Number(selected.price ?? selected.sellingPrice ?? 0),
      notes: JSON.stringify(request),
    });

    if (error) {
      // Don't lose the customer's work if the current project blocks direct
      // order inserts. Keep a local draft for the existing checkout flow.
      localStorage.setItem('storeflow_pending_service_request', JSON.stringify({ storeId: store.id, request }));
      setMessage('Your service request is saved on this phone. The store connection needs to be available before it can be sent.');
      setSubmitting(false);
      return;
    }

    setSubmitted(true);
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <div className="fixed inset-0 z-[80] bg-[#fbf9f9] overflow-y-auto">
        <div className="min-h-full max-w-xl mx-auto p-5 flex flex-col justify-center">
          <div className="rounded-[28px] bg-white border border-gray-100 shadow-xl p-7 text-center">
            <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600"><Check className="w-8 h-8" /></div>
            <h1 className="text-2xl font-black text-[#1A1C1E] mt-5">Request sent</h1>
            <p className="text-sm text-gray-500 mt-2">{selected?.name} has been sent to {store?.business_name || 'the store'}.</p>
            <button onClick={() => window.location.reload()} className="mt-6 w-full rounded-2xl bg-[#1A1C1E] text-[#FFD23F] p-4 font-black">Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] bg-[#fbf9f9] overflow-y-auto">
      <div className="max-w-xl mx-auto min-h-full pb-10">
        <header className="sticky top-0 z-10 bg-[#fbf9f9]/95 backdrop-blur border-b border-gray-100 px-4 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => window.history.back()} className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center"><ChevronLeft className="w-5 h-5" /></button>
            <div className="w-11 h-11 rounded-2xl bg-[#1A1C1E] text-[#FFD23F] flex items-center justify-center text-2xl">{template.icon || (isLaundry ? '🧺' : isGaming ? '🎮' : '🛠️')}</div>
            <div className="min-w-0"><h1 className="font-black text-lg truncate">{store?.business_name || 'Store'}</h1><p className="text-xs text-gray-500">{template.name || 'Services'}</p></div>
          </div>
        </header>

        <main className="p-4 space-y-5">
          <section><p className="text-sm text-gray-500">{template.customerExperience?.intro || 'Choose a service and tell the business what you need.'}</p><h2 className="text-2xl font-black text-[#1A1C1E] mt-1">{template.customerExperience?.primaryAction || 'Choose a service'}</h2></section>

          <section className="space-y-2">
            <h3 className="font-black text-sm">Choose a service</h3>
            {offerings.length === 0 ? <div className="rounded-2xl bg-white border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">No services are currently enabled by this business.</div> : offerings.map(o => (
              <button key={o.id} onClick={() => setSelected(o)} className={`w-full p-4 rounded-2xl border text-left flex items-center gap-3 ${selected?.id === o.id ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200 bg-white'}`}>
                <span className="text-2xl">{o.icon || '✨'}</span><span className="flex-1"><b className="block text-sm">{o.name}</b><small className="text-gray-500">{o.description || (o.pricing === 'time' ? 'Charged by time' : o.pricing === 'item' ? 'Charged per item' : 'Configured by the business')}</small></span>
                <span className="font-black text-sm">{Number(o.price ?? o.sellingPrice ?? 0) > 0 ? `₦${Number(o.price ?? o.sellingPrice).toLocaleString()}` : 'Price on request'}</span>
              </button>
            ))}
          </section>

          {isLaundry && <section className="rounded-2xl bg-white border border-gray-200 p-4 space-y-3">
            <div><h3 className="font-black text-sm">How many clothes?</h3><p className="text-xs text-gray-500 mt-1">You can simply give us the total, or specify the types below.</p></div>
            <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3"><span className="text-sm font-bold">Total clothes</span><div className="flex items-center gap-3"><button onClick={() => setClothes(prev => totalClothes > 0 ? prev.map((x,i) => i === 0 ? { ...x, quantity: Math.max(0,x.quantity-1) } : x).filter(x=>x.quantity>0) : prev)} className="w-9 h-9 rounded-full border bg-white flex items-center justify-center"><Minus className="w-4 h-4" /></button><b className="min-w-8 text-center">{totalClothes}</b><button onClick={() => setClothes(prev => prev.length ? [...prev.slice(0,-1), { ...prev[prev.length-1], quantity: prev[prev.length-1].quantity + 1 }] : [{ name: 'Other', quantity: 1 }])} className="w-9 h-9 rounded-full bg-[#1A1C1E] text-[#FFD23F] flex items-center justify-center"><Plus className="w-4 h-4" /></button></div></div>
            <div className="grid grid-cols-2 gap-2">
              {clothingOptions.map(name => { const qty = clothes.find(x => x.name === name)?.quantity || 0; return <div key={name} className={`rounded-xl border p-3 ${qty ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200 bg-white'}`}><div className="text-sm font-bold">{name}</div><div className="flex items-center justify-between mt-2"><button onClick={() => updateClothing(name,-1)} className="w-8 h-8 rounded-full border flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button><b>{qty}</b><button onClick={() => updateClothing(name,1)} className="w-8 h-8 rounded-full bg-[#1A1C1E] text-[#FFD23F] flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button></div></div>; })}
            </div>
          </section>}

          {(template.customerFeatures?.photos || isLaundry) && <section className="grid grid-cols-2 gap-2">
            <label className="p-4 rounded-2xl border border-dashed border-gray-300 bg-white flex items-center gap-3 cursor-pointer"><Camera className="w-5 h-5" /><span><b className="block text-sm">Reference photo</b><small className="text-gray-500">{referenceImage ? referenceImage.name : 'Add image'}</small></span><input type="file" accept="image/*" className="hidden" onChange={e => setReferenceImage(e.target.files?.[0] || null)} /></label>
            {(template.customerFeatures?.files || isLaundry) && <label className="p-4 rounded-2xl border border-dashed border-gray-300 bg-white flex items-center gap-3 cursor-pointer"><FileUp className="w-5 h-5" /><span><b className="block text-sm">Attach file</b><small className="text-gray-500">{attachment ? attachment.name : 'PDF or document'}</small></span><input type="file" className="hidden" onChange={e => setAttachment(e.target.files?.[0] || null)} /></label>}
          </section>}

          {template.customerFeatures?.notes !== false && <section className="rounded-2xl bg-white border border-gray-200 p-4"><h3 className="font-black text-sm">Notes</h3><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Anything the business should know?" className="w-full mt-2 min-h-24 resize-none outline-none text-sm" /></section>}

          {(template.customerFeatures?.pickup || template.customerFeatures?.delivery || isLaundry) && <section><h3 className="font-black text-sm mb-2">Fulfilment</h3><div className="grid grid-cols-2 gap-2"><button onClick={() => setFulfillment('pickup')} className={`p-4 rounded-2xl border text-left ${fulfillment === 'pickup' ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200 bg-white'}`}><MapPin className="w-5 h-5 mb-2" /><b className="block text-sm">Pickup</b><small className="text-gray-500">I’ll collect it</small></button><button onClick={() => setFulfillment('delivery')} className={`p-4 rounded-2xl border text-left ${fulfillment === 'delivery' ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200 bg-white'}`}><Truck className="w-5 h-5 mb-2" /><b className="block text-sm">Delivery</b><small className="text-gray-500">Bring it to me</small></button></div></section>}

          {message && <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">{message}</div>}
          <button disabled={!selected || submitting} onClick={submitRequest} className="w-full p-4 rounded-2xl bg-[#1A1C1E] text-[#FFD23F] font-black disabled:opacity-40 flex items-center justify-center gap-2"><Upload className="w-5 h-5" />{submitting ? 'Sending…' : 'Send Request'}</button>
        </main>
      </div>
    </div>
  );
}
