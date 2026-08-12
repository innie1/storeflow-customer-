import fs from 'node:fs';
import path from 'node:path';

const appPath = path.resolve('src/App.tsx');
let text = fs.readFileSync(appPath, 'utf8');
const marker = '// STOREFLOW_BRANDING_PATCH_V1';
if (text.includes(marker)) process.exit(0);

text = text.replace(
  "const STORE_PUBLIC_COLUMNS = 'id, store_id, business_name, currency, country, state, city, address, phone, email, logo, subscription_status, data, access_code, qr_code';",
  "const STORE_PUBLIC_COLUMNS = 'id, store_id, business_name, business_type, currency, country, state, city, address, phone, email, logo, subscription_status, data, access_code, qr_code';"
);
text = text.replace("const storeType = store?.category || 'Grocery Store';", "const storeType = getStoreBusinessTypeLabel(store);");
text = text.replace(
  '<p className="font-extrabold text-gray-400 dark:text-zinc-500 uppercase text-[9px] tracking-wider truncate">Catalog</p>',
  '<p className="font-extrabold text-gray-400 dark:text-zinc-500 uppercase text-[9px] tracking-wider truncate">{isServiceStore(store) ? \'Services\' : \'Catalog\'}</p>'
);
text = text.replace(
  '<p className="text-xs font-black text-[#1A1C1E] dark:text-zinc-100 truncate mt-0.5">{numProducts} items</p>',
  '<p className="text-xs font-black text-[#1A1C1E] dark:text-zinc-100 truncate mt-0.5">{numProducts} {isServiceStore(store) ? \'services\' : \'items\'}</p>'
);

const helperAnchor = `function isLogoImageUrl(logo?: string | null): boolean {
  if (!logo) return false;
  return logo.startsWith('http://') || logo.startsWith('https://') || logo.startsWith('data:');
}
`;
const helpers = `${helperAnchor}
${marker}
const STORE_TYPE_LABELS: Record<string, string> = {
  provision: 'Provision / Supermarket', pharmacy: 'Pharmacy / Chemist', clothing: 'Clothing / Fashion',
  electronics: 'Electronics', food: 'Food Business', laundry: 'Laundry / Dry Cleaning', barber: 'Barber Shop',
  salon: 'Salon / Beauty', tailoring: 'Tailoring / Fashion Design', repair: 'Repair Shop', printing: 'Printing / Cyber Cafe',
  cyber_cafe: 'Cyber Cafe', car_wash: 'Car Wash', photography: 'Photography', cleaning: 'Cleaning Service',
  spa: 'Spa / Wellness', gas_filling: 'Gas Filling', games: 'Gaming Centre', gaming: 'Gaming Centre',
  restaurant: 'Restaurant / Food', retail: 'Retail Store'
};
function getStoreBusinessTypeLabel(s: any): string {
  const template = s?.data?.businessTemplate;
  const label = template?.label || template?.name;
  if (typeof label === 'string' && label.trim()) return label.trim();
  const type = String(template?.type || s?.data?.storeType || s?.business_type || s?.storeType || s?.category || '').trim().toLowerCase();
  return STORE_TYPE_LABELS[type] || (type ? type.replace(/_/g, ' ').replace(/\\b\\w/g, (m: string) => m.toUpperCase()) : 'Business');
}
function getStoreLogoStyle(s: any): string {
  const value = s?.data?.profile?.logoStyle || s?.data?.logoStyle || s?.data?.businessTemplate?.logoStyle || (!isLogoImageUrl(s?.logo) ? s?.logo : null) || 'minimalist';
  return String(value).toLowerCase();
}
function getStoreLogoUrl(s: any): string | null {
  const values = [s?.logo, s?.data?.profile?.logo, s?.data?.logo, s?.data?.marketplaceSettings?.logo];
  return values.find((v: any) => isLogoImageUrl(v)) || null;
}
function escapeStoreLogoXml(v: string): string { return v.replace(/[&<>\"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&apos;' })[c]); }
function getStoreLogoMarkup(name: string, style: string): string {
  const n = escapeStoreLogoXml(name || 'Store');
  const i = escapeStoreLogoXml((name || 'S').charAt(0).toUpperCase());
  const text = (fill: string) => '<text x="120" y="132" fill="' + fill + '" font-family="Arial,sans-serif" font-weight="800" font-size="16" text-anchor="middle">' + n + '</text>';
  switch (style) {
    case 'modern': return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="60" r="40" fill="none" stroke="#10B981" stroke-width="4"/><path d="M98 50h44l-5 30h-34z" fill="none" stroke="#10B981" stroke-width="4"/><circle cx="110" cy="84" r="4" fill="#F59E0B"/><circle cx="130" cy="84" r="4" fill="#F59E0B"/>' + text('#0F172A') + '</svg>';
    case 'premium': return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="42" fill="none" stroke="#D97706" stroke-width="3"/><circle cx="120" cy="62" r="35" fill="none" stroke="#D97706" stroke-width="1" stroke-dasharray="3 3"/><text x="120" y="77" fill="#D97706" font-family="Georgia,serif" font-weight="700" font-size="42" text-anchor="middle">' + i + '</text>' + text('#D97706') + '</svg>';
    case 'bold': return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="42" fill="#DC2626"/><path d="M96 48h48l-6 32h-36z" fill="none" stroke="#fff" stroke-width="4"/><circle cx="111" cy="85" r="4" fill="#fff"/><circle cx="129" cy="85" r="4" fill="#fff"/>' + text('#1E3A8A') + '</svg>';
    case 'professional': return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="40" fill="none" stroke="#064E3B" stroke-width="4"/><path d="M100 48h40v34h-40zM110 48c0-12 20-12 20 0" fill="none" stroke="#064E3B" stroke-width="4"/>' + text('#064E3B') + '</svg>';
    case 'creative': return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="storeCreative" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F97316"/><stop offset="1" stop-color="#EC4899"/></linearGradient></defs><path d="M92 48h56l-6 38c0 7-44 7-44 0z" fill="url(#storeCreative)"/><circle cx="110" cy="66" r="3" fill="#fff"/><circle cx="130" cy="66" r="3" fill="#fff"/><path d="M108 75q12 10 24 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' + text('#5B21B6') + '</svg>';
    default: return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><path d="M96 54h48l-5 30h-38zM96 54l24-25 24 25" fill="none" stroke="#0F172A" stroke-width="4" stroke-linejoin="round"/><path d="M120 29q-7-10-13-3 6 6 13 3 7 3 13-3-6-7-13 3" fill="#10B981"/>' + text('#0F172A') + '</svg>';
  }
}
function StoreBrandMark({ store }: { store: any }) {
  const url = getStoreLogoUrl(store);
  if (url) return <img src={url} className="w-full h-full object-cover" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />;
  return <div className="w-full h-full bg-white flex items-center justify-center" dangerouslySetInnerHTML={{ __html: getStoreLogoMarkup(store?.business_name || 'Store', getStoreLogoStyle(store)) }} />;
}
`;
if (!text.includes(helperAnchor)) throw new Error('Store branding anchor not found');
text = text.replace(helperAnchor, helpers);

const logoPattern = /(<div className="absolute -top-16 w-32 h-32[^>]*>).*?(\n\s*<\/div>\n\n\s*<div className="space-y-2">)/s;
const logoReplacement = '$1\n            <StoreBrandMark store={store} />$2';
const patched = text.replace(logoPattern, logoReplacement);
if (patched === text) throw new Error('Storefront logo block not found');
text = patched;
fs.writeFileSync(appPath, text);
