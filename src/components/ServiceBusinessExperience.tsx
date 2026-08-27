import { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Check,
  ChevronLeft,
  Clock3,
  FileUp,
  Mail,
  MapPin,
  Minus,
  Phone,
  Plus,
  Store,
  Upload,
} from 'lucide-react';
import { supabase } from '../supabase';
import { parseRoute } from '../router';

type Offering = {
  id: string;
  name: string;
  description?: string;
  price?: number;
  sellingPrice?: number;
  pricing?: string;
  unit?: string;
  unitLabel?: string;
  icon?: string;
  turnaround?: string;
  garmentPrices?: Record<string, number>;
  discontinued?: boolean;
  enabled?: boolean;
  active?: boolean;
  status?: string;
};

type StoreRecord = {
  id: string;
  store_id?: string;
  access_code?: string;
  business_name?: string;
  currency?: string;
  country?: string;
  state?: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  logo?: string;
  data?: any;
};

type FieldKind = 'quantity' | 'text' | 'textarea' | 'date' | 'time' | 'choice' | 'file' | 'image';
type FieldConfig = { id: string; label: string; kind: FieldKind; options?: string[]; required?: boolean; help?: string };
type LaundryPricing = { garmentTypes: string[]; matrix: Record<string, Record<string, number>> };
type LaundryLine = { garmentType: string; quantity: number; unitPrice: number; subtotal: number };

const SERVICE_TYPES = new Set([
  'laundry', 'barber', 'salon', 'tailoring', 'repair', 'printing', 'cyber_cafe',
  'car_wash', 'photography', 'cleaning', 'spa', 'games', 'gaming', 'games_entertainment',
]);
const DEFAULT_CLOTHES = ['Shirts', 'Trousers', 'T-shirts', 'Knickers / Shorts', 'Gowns / Dresses', 'Skirts', 'Native Wear', 'Jackets', 'Duvets', 'Bedsheets'];

const PRESETS: Record<string, { title: string; intro: string; fields: FieldConfig[] }> = {
  laundry: {
    title: 'Laundry services',
    intro: 'Choose a laundry treatment, select your clothing items, and see this store’s exact prices.',
    fields: [
      { id: 'clothes', label: 'Clothing', kind: 'quantity', options: DEFAULT_CLOTHES, required: true },
      { id: 'photo', label: 'Reference photo', kind: 'image' },
      { id: 'file', label: 'Attach file', kind: 'file' },
      { id: 'notes', label: 'Notes', kind: 'textarea' },
      { id: 'fulfillment', label: 'Fulfilment', kind: 'choice', options: ['Pickup', 'Delivery'] },
    ],
  },
  barber: { title: 'Barber services', intro: 'Choose a service and book the time that works for you.', fields: [{ id: 'date', label: 'Date', kind: 'date', required: true }, { id: 'time', label: 'Preferred time', kind: 'time' }, { id: 'notes', label: 'Notes', kind: 'textarea' }] },
  salon: { title: 'Salon services', intro: 'Choose a treatment and your preferred appointment time.', fields: [{ id: 'date', label: 'Date', kind: 'date', required: true }, { id: 'time', label: 'Preferred time', kind: 'time' }, { id: 'notes', label: 'Notes', kind: 'textarea' }] },
  tailoring: { title: 'Tailoring services', intro: 'Choose what you want made or altered and provide useful references.', fields: [{ id: 'garment', label: 'Clothing type', kind: 'choice', options: ['Shirt', 'Trousers', 'Shorts', 'Dress', 'Native wear', 'Jacket', 'Other'], required: true }, { id: 'measurements', label: 'Measurements', kind: 'textarea', help: 'Enter measurements if you have them.' }, { id: 'photo', label: 'Reference photo', kind: 'image' }, { id: 'file', label: 'Reference file', kind: 'file' }, { id: 'deadline', label: 'Needed by', kind: 'date' }, { id: 'notes', label: 'Notes', kind: 'textarea' }] },
  repair: { title: 'Repair services', intro: 'Tell us what needs fixing. A photo can help the business understand the problem.', fields: [{ id: 'device', label: 'Device or item', kind: 'text', required: true }, { id: 'problem', label: 'What is wrong?', kind: 'textarea', required: true }, { id: 'photo', label: 'Problem photo', kind: 'image' }, { id: 'file', label: 'Attach document', kind: 'file' }, { id: 'notes', label: 'Notes', kind: 'textarea' }] },
  printing: { title: 'Printing services', intro: 'Choose a printing service and attach your document when needed.', fields: [{ id: 'file', label: 'Document', kind: 'file', required: true }, { id: 'copies', label: 'Copies', kind: 'quantity', options: ['Copies'], required: true }, { id: 'paper', label: 'Paper size', kind: 'choice', options: ['A4', 'A3', 'Other'] }, { id: 'notes', label: 'Print instructions', kind: 'textarea' }] },
  cyber_cafe: { title: 'Cyber services', intro: 'Choose the service you need and provide the details.', fields: [{ id: 'file', label: 'Attach file', kind: 'file' }, { id: 'notes', label: 'Details', kind: 'textarea' }] },
  car_wash: { title: 'Car wash services', intro: 'Choose a wash package and tell the business about your vehicle.', fields: [{ id: 'vehicle', label: 'Vehicle type', kind: 'choice', options: ['Car', 'SUV', 'Bus', 'Truck', 'Other'], required: true }, { id: 'notes', label: 'Notes', kind: 'textarea' }] },
  photography: { title: 'Photography services', intro: 'Choose a package and tell the business when and where you need it.', fields: [{ id: 'date', label: 'Date', kind: 'date', required: true }, { id: 'time', label: 'Preferred time', kind: 'time' }, { id: 'location', label: 'Location', kind: 'text' }, { id: 'notes', label: 'Requirements', kind: 'textarea' }] },
  cleaning: { title: 'Cleaning services', intro: 'Choose a cleaning service and tell the business what needs attention.', fields: [{ id: 'property', label: 'Property type', kind: 'choice', options: ['Room', 'Apartment', 'House', 'Office', 'Shop', 'Other'], required: true }, { id: 'date', label: 'Preferred date', kind: 'date' }, { id: 'notes', label: 'Details', kind: 'textarea' }] },
  spa: { title: 'Spa services', intro: 'Choose a treatment and your preferred appointment time.', fields: [{ id: 'date', label: 'Date', kind: 'date', required: true }, { id: 'time', label: 'Preferred time', kind: 'time' }, { id: 'notes', label: 'Notes', kind: 'textarea' }] },
  games: { title: 'Gaming', intro: 'Choose a game, see this centre’s price, and select how long you want to play.', fields: [{ id: 'duration', label: 'Duration', kind: 'choice', options: ['30 minutes', '1 hour', '2 hours', '3 hours', 'Other'], required: true }, { id: 'players', label: 'Players', kind: 'quantity', options: ['Players'], required: true }, { id: 'date', label: 'Date', kind: 'date' }, { id: 'time', label: 'Preferred time', kind: 'time' }] },
  gaming: { title: 'Gaming', intro: 'Choose a game, see this centre’s price, and select how long you want to play.', fields: [{ id: 'duration', label: 'Duration', kind: 'choice', options: ['30 minutes', '1 hour', '2 hours', '3 hours', 'Other'], required: true }, { id: 'players', label: 'Players', kind: 'quantity', options: ['Players'], required: true }, { id: 'date', label: 'Date', kind: 'date' }, { id: 'time', label: 'Preferred time', kind: 'time' }] },
  games_entertainment: { title: 'Games & entertainment', intro: 'Choose an experience and provide the details this centre needs.', fields: [{ id: 'duration', label: 'Duration', kind: 'choice', options: ['30 minutes', '1 hour', '2 hours', '3 hours', 'Other'] }, { id: 'players', label: 'Players', kind: 'quantity', options: ['Players'] }, { id: 'date', label: 'Date', kind: 'date' }, { id: 'time', label: 'Preferred time', kind: 'time' }, { id: 'notes', label: 'Notes', kind: 'textarea' }] },
};

function normalizeBusinessType(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  const aliases: Record<string, string> = {
    laundr: 'laundry',
    laundry_service: 'laundry',
    laundry_services: 'laundry',
    barber_shop: 'barber',
    barbing_salon: 'barber',
    beauty_salon: 'salon',
    fashion_design: 'tailoring',
    tailor: 'tailoring',
    repair_shop: 'repair',
    cybercafe: 'cyber_cafe',
    cyber_cafe_business: 'cyber_cafe',
    carwash: 'car_wash',
    photo_studio: 'photography',
    cleaning_service: 'cleaning',
    spa_wellness: 'spa',
    gaming_centre: 'gaming',
    gaming_center: 'gaming',
  };
  return aliases[raw] || raw;
}

function serviceTemplate(store: StoreRecord | null): any {
  const data = store?.data || {};
  return data.businessTemplate || data.business_template || data.serviceTemplate || data.service_template || {};
}

function businessType(store: StoreRecord): string {
  const data = store.data || {};
  const template = serviceTemplate(store);
  return normalizeBusinessType(template.type || template.businessType || template.storeType || data.storeType || data.businessType || data.business_type || data.businessCategory || '');
}

function storeProfile(store: StoreRecord | null): any {
  return store?.data?.profile || store?.data?.storeProfile || {};
}

function serviceProducts(store: StoreRecord | null): any[] {
  const data = store?.data || {};
  const lists = [data.products, data.services, data.serviceProducts, data.service_products];
  for (const list of lists) if (Array.isArray(list)) return list;
  return [];
}

function isServiceProduct(product: any): boolean {
  return Boolean(product && (product.isService === true || product.is_service === true || product.type === 'service' || product.kind === 'service') && product.discontinued !== true && product.deleted !== true);
}

function isEnabledOffering(offering: Offering): boolean {
  return Boolean(offering && offering.discontinued !== true && offering.enabled !== false && offering.active !== false && offering.status !== 'inactive');
}

function normalizeOffering(raw: any): Offering {
  return {
    id: String(raw.id),
    name: String(raw.name || 'Service'),
    description: String(raw.description || ''),
    price: Number(raw.price ?? raw.sellingPrice ?? raw.selling_price ?? 0),
    sellingPrice: Number(raw.sellingPrice ?? raw.selling_price ?? raw.price ?? 0),
    pricing: String(raw.pricing || raw.servicePricing || raw.service_pricing || 'fixed'),
    unit: String(raw.unit || ''),
    unitLabel: String(raw.unitLabel || raw.unit_label || ''),
    icon: raw.icon ? String(raw.icon) : undefined,
    turnaround: String(raw.turnaround || raw.turnaroundTime || raw.turnaround_time || ''),
    garmentPrices: raw.garmentPrices && typeof raw.garmentPrices === 'object' ? raw.garmentPrices : undefined,
    discontinued: raw.discontinued,
    enabled: raw.enabled,
    active: raw.active,
    status: raw.status,
  };
}

function presetFor(type: string, template: any) {
  const base = PRESETS[type] || {
    title: template?.name || 'Services',
    intro: 'Choose a service and provide the details this business needs.',
    fields: [{ id: 'notes', label: 'Notes', kind: 'textarea' } as FieldConfig],
  };
  const custom = Array.isArray(template?.customerFields)
    ? template.customerFields.filter((field: any) => field?.id && field?.label && field?.kind)
    : [];
  return custom.length ? { ...base, fields: custom as FieldConfig[] } : base;
}

function uniqueNames(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const name = String(value || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function laundryPricing(store: StoreRecord | null, offerings: Offering[]): LaundryPricing {
  const data = store?.data || {};
  const template = serviceTemplate(store);
  const raw = template.laundryPricing || data.laundryPricing || data.laundry_pricing || {};
  const configuredNames = Array.isArray(raw.garmentTypes) ? raw.garmentTypes : [];
  const offeringNames = offerings.flatMap(offering => Object.keys(offering.garmentPrices || {}));
  const garmentTypes = uniqueNames(configuredNames.length || offeringNames.length ? [...configuredNames, ...offeringNames] : DEFAULT_CLOTHES);
  return {
    garmentTypes,
    matrix: raw.matrix && typeof raw.matrix === 'object' ? raw.matrix : {},
  };
}

function caseInsensitiveValue(record: Record<string, number> | undefined, key: string): number | null {
  if (!record) return null;
  const direct = Number(record[key]);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const match = Object.entries(record).find(([name]) => name.toLowerCase() === key.toLowerCase());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function garmentUnitPrice(offering: Offering | null, config: LaundryPricing, garment: string): number {
  if (!offering) return 0;
  const offeringPrice = caseInsensitiveValue(offering.garmentPrices, garment);
  if (offeringPrice !== null) return offeringPrice;
  const matrixPrice = caseInsensitiveValue(config.matrix[String(offering.id)], garment);
  if (matrixPrice !== null) return matrixPrice;
  return Math.max(0, Number(offering.price ?? offering.sellingPrice ?? 0) || 0);
}

function buildLaundryLines(offering: Offering | null, config: LaundryPricing, clothing: Record<string, number>): LaundryLine[] {
  if (!offering) return [];
  return Object.entries(clothing)
    .map(([garmentType, rawQuantity]) => {
      const quantity = Math.max(0, Number(rawQuantity) || 0);
      const unitPrice = garmentUnitPrice(offering, config, garmentType);
      return { garmentType, quantity, unitPrice, subtotal: unitPrice * quantity };
    })
    .filter(line => line.quantity > 0);
}

function offeringPriceLabel(offering: Offering, type: string, config: LaundryPricing): string {
  const pricing = String(offering.pricing || '').toLowerCase();
  const price = Number(offering.price ?? offering.sellingPrice ?? 0);
  if (type === 'laundry' && pricing === 'per_piece') {
    const values = config.garmentTypes.map(name => garmentUnitPrice(offering, config, name)).filter(value => value > 0);
    if (values.length) return `From ₦${Math.min(...values).toLocaleString()} / item`;
    return 'Price varies by clothing';
  }
  if (pricing === 'quote') return 'Get a quote';
  if (pricing === 'appointment') return price > 0 ? `₦${price.toLocaleString()} · appointment` : 'Book appointment';
  if (pricing === 'time' || pricing === 'per_hour') return price > 0 ? `₦${price.toLocaleString()} / hour` : 'Price not set';
  if (pricing === 'per_session') return price > 0 ? `₦${price.toLocaleString()} / session` : 'Price not set';
  if (pricing === 'per_piece') return price > 0 ? `₦${price.toLocaleString()} / piece` : 'Price not set';
  if (pricing === 'per_kg') return price > 0 ? `₦${price.toLocaleString()} / kg` : 'Price not set';
  if (pricing === 'per_load') return price > 0 ? `₦${price.toLocaleString()} / load` : 'Price not set';
  if (pricing === 'per_page') return price > 0 ? `₦${price.toLocaleString()} / page` : 'Price not set';
  if (offering.unitLabel) return price > 0 ? `₦${price.toLocaleString()} ${offering.unitLabel}` : 'Price not set';
  return price > 0 ? `₦${price.toLocaleString()}` : 'Price on request';
}

function calculateTotal(offering: Offering | null, type: string, values: Record<string, any>, totalClothes: number, laundryLines: LaundryLine[]): number {
  if (!offering) return 0;
  const price = Number(offering.price ?? offering.sellingPrice ?? 0);
  const pricing = String(offering.pricing || '').toLowerCase();
  if (type === 'laundry' && pricing === 'per_piece') return laundryLines.reduce((sum, line) => sum + line.subtotal, 0);
  if (!Number.isFinite(price) || price <= 0) return 0;
  if (pricing === 'per_piece') return price * totalClothes;
  if (pricing === 'per_kg') return price * Number(values.kg || 0);
  if (pricing === 'per_load') return price * Number(values.loads || values.load || 1);
  if (pricing === 'per_page') return price * Number(values.pages || values.copies || 0);
  if (pricing === 'time' || pricing === 'per_hour') {
    const duration = String(values.duration || '');
    if (duration.startsWith('30')) return price * 0.5;
    if (duration.startsWith('1')) return price;
    if (duration.startsWith('2')) return price * 2;
    if (duration.startsWith('3')) return price * 3;
  }
  if (pricing === 'quote' || pricing === 'appointment') return 0;
  return price;
}

function getFulfillmentOptions(template: any): string[] {
  const modules = Array.isArray(template?.modules) ? template.modules.map((value: unknown) => String(value).toLowerCase()) : [];
  const features = template?.customerFeatures || {};
  const options: string[] = [];
  if (features.pickup === true || modules.includes('pickup')) options.push('Pickup');
  if (features.delivery === true || modules.includes('delivery')) options.push('Delivery');
  return options;
}

function serializableFields(values: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => {
    if (typeof File !== 'undefined' && value instanceof File) {
      return [key, { name: value.name, type: value.type, size: value.size }];
    }
    return [key, value];
  }));
}

function formatLocation(store: StoreRecord | null): string {
  if (!store) return '';
  const profile = storeProfile(store);
  const primary = String(store.address || profile.location || '').trim();
  const secondary = uniqueNames([store.city, store.state, store.country]).join(', ');
  return [primary, secondary].filter(Boolean).join(' · ');
}

async function findPublicStore(identifier: string): Promise<StoreRecord | null> {
  const value = identifier.trim();
  if (!value) return null;
  const columns = 'id,store_id,access_code,business_name,currency,country,state,city,address,phone,email,logo,data';
  const uuidLike = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const candidates = uuidLike ? ['id', 'store_id', 'access_code'] : ['store_id', 'access_code'];

  for (const column of candidates) {
    const { data, error } = await supabase.from('stores_public').select(columns).eq(column, value).maybeSingle();
    if (!error && data) return data as StoreRecord;
    if (error && error.code !== 'PGRST116') console.debug(`[ServiceBusinessExperience] ${column} lookup failed`, error.message);
  }
  return null;
}

export default function ServiceBusinessExperience() {
  const route = parseRoute();
  const [store, setStore] = useState<StoreRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(route.storeId));
  const [selected, setSelected] = useState<Offering | null>(null);
  const [values, setValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [customerName, setCustomerName] = useState(() => {
    try { return localStorage.getItem('storeflow_saved_checkout_name') || ''; } catch { return ''; }
  });
  const [customerPhone, setCustomerPhone] = useState(() => {
    try { return localStorage.getItem('storeflow_saved_checkout_phone') || ''; } catch { return ''; }
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!route.storeId) { setLoading(false); return; }
      const found = await findPublicStore(route.storeId);
      if (!cancelled) {
        setStore(found);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [route.storeId]);

  const type = store ? businessType(store) : '';
  const template = serviceTemplate(store);
  const profile = storeProfile(store);

  const offerings = useMemo<Offering[]>(() => {
    if (!store) return [];
    if (['games', 'gaming', 'games_entertainment'].includes(type) && Array.isArray(store.data?.games)) {
      return store.data.games
        .filter((game: any) => game?.enabled !== false)
        .map((game: any) => normalizeOffering({ ...game, icon: game.icon || '🎮', pricing: 'time', unitLabel: '/ hour', enabled: true, active: true }));
    }
    const configured = Array.isArray(template?.offerings) ? template.offerings.map(normalizeOffering).filter(isEnabledOffering) : [];
    if (configured.length) return configured;
    return serviceProducts(store).filter(isServiceProduct).map(normalizeOffering).filter(isEnabledOffering);
  }, [store, template, type]);

  const hasServiceProducts = serviceProducts(store).some(isServiceProduct);
  const modeValues = Array.isArray(template?.modes) ? template.modes.map((mode: unknown) => String(mode).toLowerCase()) : [];
  const isServiceStore = SERVICE_TYPES.has(type) || modeValues.includes('services') || modeValues.includes('service') || offerings.length > 0 || hasServiceProducts;
  const preset = useMemo(() => presetFor(type, template), [type, template]);
  const pricingConfig = useMemo(() => laundryPricing(store, offerings), [store, offerings]);
  const fulfillmentOptions = useMemo(() => getFulfillmentOptions(template), [template]);
  const effectiveFields = useMemo(() => preset.fields.flatMap(field => {
    if (field.id !== 'fulfillment') return [field];
    return fulfillmentOptions.length ? [{ ...field, options: fulfillmentOptions }] : [];
  }), [preset.fields, fulfillmentOptions]);

  if (!route.storeId || !isServiceStore || (!loading && !store)) return null;
  if (loading) return null;

  const setValue = (id: string, value: any) => setValues(previous => ({ ...previous, [id]: value }));
  const qty = (id: string) => Number(values[id] || 0);
  const inc = (id: string) => setValue(id, Math.max(0, qty(id) + 1));
  const dec = (id: string) => setValue(id, Math.max(0, qty(id) - 1));
  const clothing = (values.clothes || {}) as Record<string, number>;
  const updateCloth = (name: string, delta: number) => setValue('clothes', { ...clothing, [name]: Math.max(0, Number(clothing[name] || 0) + delta) });
  const totalClothes = Object.values(clothing).reduce((sum, value) => sum + Number(value || 0), 0);
  const laundryLines = buildLaundryLines(selected, pricingConfig, clothing);
  const selectedPricing = String(selected?.pricing || '').toLowerCase();
  const fieldsMissing = effectiveFields.some(field => field.required && field.id !== 'notes' && field.id !== 'photo' && field.id !== 'file' && (field.id === 'clothes' ? totalClothes === 0 : !values[field.id]));
  const identityMissing = !customerName.trim() || !customerPhone.trim();
  const requiredMissing = fieldsMissing || identityMissing;
  const total = calculateTotal(selected, type, values, totalClothes, laundryLines);
  const storePhone = String(store?.phone || profile.phone || '').trim();
  const storeEmail = String(store?.email || profile.email || '').trim();
  const storeLocation = formatLocation(store);
  const openingHours = profile.openingTime && profile.closingTime ? `${profile.openingTime} – ${profile.closingTime}` : '';
  const offeringNoun = String(template?.labels?.offeringNoun || (type === 'laundry' ? 'Laundry Service' : 'Service'));
  const pageTitle = String(template?.customerExperience?.title || template?.name || preset.title);
  const intro = String(template?.customerExperience?.intro || preset.intro);

  const submitRequest = async () => {
    if (!store || !selected) return;
    if (requiredMissing) {
      setMessage(identityMissing ? 'Enter your name and phone number so the business can identify and contact you.' : 'Complete the required details before sending your request.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      localStorage.setItem('storeflow_saved_checkout_name', customerName.trim());
      localStorage.setItem('storeflow_saved_checkout_phone', customerPhone.trim());
    } catch { /* non-fatal */ }

    const request = {
      kind: type === 'laundry' ? 'laundry_request' : 'service_request',
      business_type: type,
      service_id: selected.id,
      service_name: selected.name,
      service_snapshot: {
        id: selected.id,
        name: selected.name,
        pricing: selected.pricing || 'fixed',
        price: Number(selected.price ?? selected.sellingPrice ?? 0),
        turnaround: selected.turnaround || '',
      },
      pricing: selected.pricing || 'fixed',
      unit_label: selected.unitLabel || '',
      fields: serializableFields(values),
      fulfillment: values.fulfillment || null,
      clothing: type === 'laundry' ? clothing : null,
      garment_lines: type === 'laundry' ? laundryLines.map(line => ({ garment_type: line.garmentType, quantity: line.quantity, unit_price: line.unitPrice, subtotal: line.subtotal })) : null,
      garment_summary: type === 'laundry' ? laundryLines.map(line => `${line.quantity}× ${line.garmentType}`).join(', ') : null,
      total_clothes: type === 'laundry' ? totalClothes : null,
      calculated_total: total,
      store_name: store.business_name || '',
      created_at: new Date().toISOString(),
    };

    const prefix = type === 'laundry' ? 'LND' : 'SVC';
    const orderNumber = `${prefix}-${Date.now().toString(36).toUpperCase()}`;
    const clientRef = `${prefix.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const payload: Record<string, any> = {
      store_id: store.id,
      order_number: orderNumber,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      status: 'Pending',
      subtotal: total,
      total,
      notes: JSON.stringify(request),
      business_type: type || 'service',
      order_kind: type === 'laundry' ? 'laundry' : 'service',
      service_metadata: request,
      client_ref: clientRef,
    };
    if (type === 'laundry') payload.workflow_stage = 'received';

    const { error } = await supabase.from('orders').insert(payload);
    if (error) {
      try { localStorage.setItem('storeflow_pending_service_request', JSON.stringify({ storeId: store.id, payload, request })); } catch { /* non-fatal */ }
      setMessage('Your request is saved on this phone. It will be sent when a live store connection is available.');
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
            {total > 0 && <p className="font-black text-[#1A1C1E] mt-3">₦{total.toLocaleString()}</p>}
            <button onClick={() => window.location.reload()} className="mt-6 w-full rounded-2xl bg-[#1A1C1E] text-[#FFD23F] p-4 font-black">Done</button>
          </div>
        </div>
      </div>
    );
  }

  const field = (fieldConfig: FieldConfig) => {
    if (fieldConfig.id === 'clothes') {
      return (
        <section key={fieldConfig.id} className="rounded-2xl bg-white border border-gray-200 p-4 space-y-3">
          <div>
            <h3 className="font-black text-sm">{fieldConfig.label} *</h3>
            <p className="text-xs text-gray-500 mt-1">These clothing types and prices come directly from {store?.business_name || 'this laundry'}.</p>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-gray-50 p-3">
            <span className="text-sm font-bold">Total pieces</span><b>{totalClothes}</b>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {pricingConfig.garmentTypes.map(name => {
              const count = Number(clothing[name] || 0);
              const unitPrice = selectedPricing === 'per_piece' ? garmentUnitPrice(selected, pricingConfig, name) : 0;
              return (
                <div key={name} className={`rounded-xl border p-3 ${count ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200 bg-white'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold truncate">{name}</div>
                      {selectedPricing === 'per_piece' && <div className="text-[11px] text-gray-500 mt-0.5">{unitPrice > 0 ? `₦${unitPrice.toLocaleString()} each` : 'Price not set'}</div>}
                    </div>
                    {count > 0 && unitPrice > 0 && <span className="text-[11px] font-black whitespace-nowrap">₦{(count * unitPrice).toLocaleString()}</span>}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <button type="button" onClick={() => updateCloth(name, -1)} className="w-8 h-8 rounded-full border bg-white flex items-center justify-center"><Minus className="w-3.5 h-3.5" /></button>
                    <b>{count}</b>
                    <button type="button" onClick={() => updateCloth(name, 1)} className="w-8 h-8 rounded-full bg-[#1A1C1E] text-[#FFD23F] flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      );
    }
    if (fieldConfig.kind === 'quantity') {
      return (
        <section key={fieldConfig.id} className="rounded-2xl bg-white border border-gray-200 p-4">
          <h3 className="font-black text-sm">{fieldConfig.label}{fieldConfig.required ? ' *' : ''}</h3>
          <div className="flex items-center justify-between mt-3 rounded-xl bg-gray-50 p-3">
            <span className="text-sm">{fieldConfig.options?.[0] || fieldConfig.label}</span>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => dec(fieldConfig.id)} className="w-9 h-9 rounded-full border bg-white flex items-center justify-center"><Minus className="w-4 h-4" /></button>
              <b>{qty(fieldConfig.id)}</b>
              <button type="button" onClick={() => inc(fieldConfig.id)} className="w-9 h-9 rounded-full bg-[#1A1C1E] text-[#FFD23F] flex items-center justify-center"><Plus className="w-4 h-4" /></button>
            </div>
          </div>
        </section>
      );
    }
    if (fieldConfig.kind === 'choice') {
      return (
        <section key={fieldConfig.id}>
          <h3 className="font-black text-sm mb-2">{fieldConfig.label}{fieldConfig.required ? ' *' : ''}</h3>
          <div className="flex flex-wrap gap-2">
            {(fieldConfig.options || []).map(option => (
              <button type="button" key={option} onClick={() => setValue(fieldConfig.id, option)} className={`px-4 py-3 rounded-xl border text-sm font-bold ${values[fieldConfig.id] === option ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200 bg-white'}`}>{option}</button>
            ))}
          </div>
        </section>
      );
    }
    if (fieldConfig.kind === 'image' || fieldConfig.kind === 'file') {
      return (
        <label key={fieldConfig.id} className="p-4 rounded-2xl border border-dashed border-gray-300 bg-white flex items-center gap-3 cursor-pointer">
          <span className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center">{fieldConfig.kind === 'image' ? <Camera className="w-5 h-5" /> : <FileUp className="w-5 h-5" />}</span>
          <span><b className="block text-sm">{fieldConfig.label}</b><small className="text-gray-500">{values[fieldConfig.id]?.name || 'Tap to add'}</small></span>
          <input type="file" accept={fieldConfig.kind === 'image' ? 'image/*' : undefined} className="hidden" onChange={event => setValue(fieldConfig.id, event.target.files?.[0] || null)} />
        </label>
      );
    }
    const inputType = fieldConfig.kind === 'textarea' ? 'textarea' : fieldConfig.kind;
    return (
      <section key={fieldConfig.id}>
        <label className="font-black text-sm">{fieldConfig.label}{fieldConfig.required ? ' *' : ''}</label>
        {fieldConfig.help && <p className="text-xs text-gray-500 mt-1">{fieldConfig.help}</p>}
        {inputType === 'textarea'
          ? <textarea value={values[fieldConfig.id] || ''} onChange={event => setValue(fieldConfig.id, event.target.value)} className="w-full mt-2 min-h-24 rounded-2xl border border-gray-200 bg-white p-4 outline-none text-sm" placeholder={fieldConfig.help || `Enter ${fieldConfig.label.toLowerCase()}`} />
          : <input type={inputType} value={values[fieldConfig.id] || ''} onChange={event => setValue(fieldConfig.id, event.target.value)} className="w-full mt-2 rounded-2xl border border-gray-200 bg-white p-4 outline-none text-sm" />}
      </section>
    );
  };

  const configuredAction = String(template?.customerExperience?.primaryAction || template?.labels?.primaryAction || '').trim();
  const actionLabel = selectedPricing === 'quote' ? 'Request a quote' : selectedPricing === 'appointment' ? 'Book appointment' : configuredAction || (type === 'laundry' ? 'Book Laundry' : 'Send Request');

  return (
    <div className="fixed inset-0 z-[80] bg-[#fbf9f9] overflow-y-auto text-[#1A1C1E]">
      <div className="max-w-xl mx-auto min-h-full pb-10">
        <header className="sticky top-0 z-10 bg-[#fbf9f9]/95 backdrop-blur border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => window.history.back()} className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center"><ChevronLeft className="w-5 h-5" /></button>
            {store?.logo ? (
              <img src={store.logo} alt={`${store.business_name || 'Store'} logo`} className="w-12 h-12 rounded-2xl object-cover bg-white border border-gray-200" />
            ) : (
              <div className="w-12 h-12 rounded-2xl bg-[#1A1C1E] text-[#FFD23F] flex items-center justify-center text-2xl">{template.icon || <Store className="w-5 h-5" />}</div>
            )}
            <div className="min-w-0 flex-1">
              <h1 className="font-black text-lg truncate">{store?.business_name || 'Store'}</h1>
              <p className="text-xs text-gray-500 truncate">{pageTitle}</p>
            </div>
          </div>
        </header>

        <main className="p-4 space-y-5">
          <section className="rounded-3xl bg-white border border-gray-200 p-4 space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide font-black text-gray-400">About this store</p>
              <h2 className="text-xl font-black mt-1">{store?.business_name}</h2>
            </div>
            <div className="space-y-2 text-sm">
              {storeLocation && <div className="flex items-start gap-2 text-gray-600"><MapPin className="w-4 h-4 mt-0.5 shrink-0" /><span>{storeLocation}</span></div>}
              {storePhone && <a href={`tel:${storePhone}`} className="flex items-center gap-2 text-gray-600"><Phone className="w-4 h-4 shrink-0" /><span>{storePhone}</span></a>}
              {storeEmail && <a href={`mailto:${storeEmail}`} className="flex items-center gap-2 text-gray-600"><Mail className="w-4 h-4 shrink-0" /><span className="truncate">{storeEmail}</span></a>}
              {openingHours && <div className="flex items-center gap-2 text-gray-600"><Clock3 className="w-4 h-4 shrink-0" /><span>{openingHours}</span></div>}
              {!storeLocation && !storePhone && !storeEmail && !openingHours && <p className="text-xs text-gray-400">This business has not added public contact details yet.</p>}
            </div>
          </section>

          <section>
            <p className="text-sm text-gray-500">{intro}</p>
            <h2 className="text-2xl font-black mt-1">Choose {offeringNoun.toLowerCase().startsWith('a ') ? offeringNoun.toLowerCase() : `a ${offeringNoun.toLowerCase()}`}</h2>
          </section>

          <section className="space-y-2">
            <h3 className="font-black text-sm">Available {offeringNoun.toLowerCase()}s</h3>
            {offerings.length === 0 ? (
              <div className="rounded-2xl bg-white border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">{store?.business_name || 'This business'} has not published any services yet.</div>
            ) : offerings.map(offering => (
              <button
                type="button"
                key={offering.id}
                onClick={() => { setSelected(offering); setValues({}); setMessage(''); }}
                className={`w-full p-4 rounded-2xl border text-left flex items-center gap-3 ${selected?.id === offering.id ? 'border-[#FFD23F] bg-[#FFF9DE]' : 'border-gray-200 bg-white'}`}
              >
                <span className="text-2xl">{offering.icon || template.icon || '✨'}</span>
                <span className="flex-1 min-w-0">
                  <b className="block text-sm truncate">{offering.name}</b>
                  <small className="text-gray-500 line-clamp-2">{offering.description || offering.turnaround || offeringNoun}</small>
                </span>
                <span className="font-black text-sm whitespace-nowrap">{offeringPriceLabel(offering, type, pricingConfig)}</span>
              </button>
            ))}
          </section>

          {selected && (
            <section className="space-y-4">
              <div className="rounded-2xl bg-[#1A1C1E] text-white p-4">
                <p className="text-xs text-gray-300">Selected {offeringNoun.toLowerCase()}</p>
                <h3 className="font-black text-lg text-[#FFD23F] mt-1">{selected.name}</h3>
                <p className="text-sm text-white mt-2">{offeringPriceLabel(selected, type, pricingConfig)}</p>
                {selected.turnaround && <p className="text-xs text-gray-300 mt-1">Turnaround: {selected.turnaround}</p>}
                {total > 0 && <p className="text-sm text-[#FFD23F] font-black mt-2">Estimated total: ₦{total.toLocaleString()}</p>}
              </div>

              {selectedPricing === 'per_kg' && (
                <section className="rounded-2xl bg-white border border-gray-200 p-4">
                  <label className="font-black text-sm">Weight (KG)</label>
                  <input type="number" min="0" step="0.1" value={values.kg || ''} onChange={event => setValue('kg', event.target.value)} className="w-full mt-2 rounded-2xl border border-gray-200 bg-white p-4 outline-none text-sm" placeholder="e.g. 5" />
                </section>
              )}

              {effectiveFields.map(field)}

              {type === 'laundry' && laundryLines.length > 0 && selectedPricing === 'per_piece' && (
                <section className="rounded-2xl bg-white border border-gray-200 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100"><h3 className="font-black text-sm">Laundry price breakdown</h3></div>
                  <div className="divide-y divide-gray-100">
                    {laundryLines.map(line => (
                      <div key={line.garmentType} className="px-4 py-3 flex items-center justify-between gap-3 text-sm">
                        <span>{line.quantity} × {line.garmentType} <span className="text-gray-400">@ ₦{line.unitPrice.toLocaleString()}</span></span>
                        <b>₦{line.subtotal.toLocaleString()}</b>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-3 bg-[#FFF9DE] flex items-center justify-between font-black"><span>Total</span><span>₦{total.toLocaleString()}</span></div>
                </section>
              )}

              <section className="rounded-2xl bg-white border border-gray-200 p-4 space-y-3">
                <div><h3 className="font-black text-sm">Your details</h3><p className="text-xs text-gray-500 mt-1">Required so {store?.business_name || 'the business'} can identify and contact you about this request.</p></div>
                <input value={customerName} onChange={event => setCustomerName(event.target.value)} autoComplete="name" placeholder="Your name" className="w-full rounded-xl border border-gray-200 p-3.5 text-sm outline-none focus:border-[#FFD23F]" />
                <input value={customerPhone} onChange={event => setCustomerPhone(event.target.value)} autoComplete="tel" inputMode="tel" placeholder="Phone number" className="w-full rounded-xl border border-gray-200 p-3.5 text-sm outline-none focus:border-[#FFD23F]" />
              </section>
            </section>
          )}

          {message && <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">{message}</div>}

          {selected && (
            <button disabled={requiredMissing || submitting} onClick={submitRequest} className="w-full p-4 rounded-2xl bg-[#1A1C1E] text-[#FFD23F] font-black disabled:opacity-40 flex items-center justify-center gap-2">
              <Upload className="w-5 h-5" />{submitting ? 'Sending…' : actionLabel}
            </button>
          )}
        </main>
      </div>
    </div>
  );
}
