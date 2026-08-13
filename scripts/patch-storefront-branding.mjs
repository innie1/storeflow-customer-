import fs from 'node:fs';

const file = 'src/App.tsx';
let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// STOREFLOW_BRANDING_PATCH_V2';
if (text.includes(marker)) process.exit(0);

text = text.replace(
  "const STORE_PUBLIC_COLUMNS = 'id, store_id, business_name, currency, country, state, city, address, phone, email, logo, subscription_status, data, access_code, qr_code';",
  "const STORE_PUBLIC_COLUMNS = 'id, store_id, business_name, business_type, currency, country, state, city, address, phone, email, logo, subscription_status, data, access_code, qr_code';"
);

text = text.replace(
  "const storeType = store?.category || 'Grocery Store';",
  "const storeType = getStoreBusinessTypeLabel(store);"
);

text = text.replace(
  '<p className="font-extrabold text-gray-400 dark:text-zinc-500 uppercase text-[9px] tracking-wider truncate">Catalog</p>',
  '<p className="font-extrabold text-gray-400 dark:text-zinc-500 uppercase text-[9px] tracking-wider truncate">{isServiceStore(store) ? \'Services\' : \'Catalog\'}</p>'
);
text = text.replace(
  '<p className="text-xs font-black text-[#1A1C1E] dark:text-zinc-100 truncate mt-0.5">{numProducts} items</p>',
  '<p className="text-xs font-black text-[#1A1C1E] dark:text-zinc-100 truncate mt-0.5">{numProducts} {isServiceStore(store) ? \'services\' : \'items\'}</p>'
);

const anchor = `function isLogoImageUrl(logo?: string | null): boolean {\n  if (!logo) return false;\n  return logo.startsWith('http://') || logo.startsWith('https://') || logo.startsWith('data:');\n}\n`;
if (!text.includes(anchor)) throw new Error('Branding anchor not found');

const helpers = `${anchor}\n${marker}\nconst STORE_TYPE_LABELS: Record<string, string> = {\n  provision: 'Provision / Supermarket', pharmacy: 'Pharmacy / Chemist', clothing: 'Clothing / Fashion', electronics: 'Electronics', food: 'Food Business', laundry: 'Laundry / Dry Cleaning', barber: 'Barber Shop', salon: 'Salon / Beauty', tailoring: 'Tailoring / Fashion Design', repair: 'Repair Shop', printing: 'Printing / Cyber Cafe', cyber_cafe: 'Cyber Cafe', car_wash: 'Car Wash', photography: 'Photography', cleaning: 'Cleaning Service', spa: 'Spa / Wellness', gas_filling: 'Gas Filling', games: 'Gaming Centre', gaming: 'Gaming Centre', restaurant: 'Restaurant / Food', retail: 'Retail Store'\n};\nfunction getStoreBusinessTypeLabel(s: any): string {\n  const t = s?.data?.businessTemplate;\n  const label = t?.label || t?.name;\n  if (typeof label === 'string' && label.trim()) return label.trim();\n  const type = String(t?.type || s?.data?.storeType || s?.business_type || s?.storeType || s?.category || '').trim().toLowerCase();\n  return STORE_TYPE_LABELS[type] || (type ? type.replace(/_/g, ' ').replace(/\\b\\w/g, (m: string) => m.toUpperCase()) : 'Business');\n}\nfunction getStoreLogoStyle(s: any): string {\n  const value = s?.data?.profile?.logoStyle || s?.data?.logoStyle || s?.data?.businessTemplate?.logoStyle || (!isLogoImageUrl(s?.logo) ? s?.logo : null) || 'minimalist';\n  return String(value).toLowerCase();\n}\nfunction getStoreLogoUrl(s: any): string | null {\n  const values = [s?.logo, s?.data?.profile?.logo, s?.data?.logo, s?.data?.marketplaceSettings?.logo];\n  return values.find((v: any) => isLogoImageUrl(v)) || null;\n}\nfunction getStoreBrandSvg(name: string, style: string): string {\n  const safe = name.replace(/[&<>\"']/g, '');\n  const initial = safe.charAt(0).toUpperCase() || 'S';\n  if (style === 'premium') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="65" r="42" fill="none" stroke="#D97706" stroke-width="3"/><text x="120" y="80" text-anchor="middle" fill="#D97706" font-family="Arial" font-size="42" font-weight="700">' + initial + '</text><text x="120" y="135" text-anchor="middle" fill="#D97706" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';\n  if (style === 'modern') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="60" r="40" fill="none" stroke="#10B981" stroke-width="4"/><path d="M98 50h44l-5 30h-34z" fill="none" stroke="#10B981" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#0F172A" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';\n  if (style === 'bold') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="42" fill="#DC2626"/><text x="120" y="78" text-anchor="middle" fill="#fff" font-family="Arial" font-size="40" font-weight="900">' + initial + '</text><text x="120" y="135" text-anchor="middle" fill="#1E3A8A" font-family="Arial" font-size="16" font-weight="900">' + safe + '</text></svg>';\n  if (style === 'professional') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="40" fill="none" stroke="#064E3B" stroke-width="4"/><path d="M100 48h40v34h-40z" fill="none" stroke="#064E3B" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#064E3B" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';\n  if (style === 'creative') return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><circle cx="120" cy="62" r="42" fill="#EC4899"/><text x="120" y="78" text-anchor="middle" fill="#fff" font-family="Arial" font-size="40" font-weight="900">' + initial + '</text><text x="120" y="135" text-anchor="middle" fill="#5B21B6" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';\n  return '<svg viewBox="0 0 240 180" xmlns="http://www.w3.org/2000/svg"><path d="M96 54h48l-5 30h-38zM96 54l24-25 24 25" fill="none" stroke="#0F172A" stroke-width="4"/><text x="120" y="135" text-anchor="middle" fill="#0F172A" font-family="Arial" font-size="16" font-weight="800">' + safe + '</text></svg>';\n}\nfunction StoreBrandMark({ store }: { store: any }) {\n  const url = getStoreLogoUrl(store);\n  if (url) return <img src={url} className="w-full h-full object-cover" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />;\n  return <div className="w-full h-full bg-white flex items-center justify-center" dangerouslySetInnerHTML={{ __html: getStoreBrandSvg(store?.business_name || 'Store', getStoreLogoStyle(store)) }} />;\n}\n`;
text = text.replace(anchor, helpers);

const oldLogo = `<div className="absolute -top-16 w-32 h-32 rounded-full border-4 border-white bg-white shadow-xl overflow-hidden flex items-center justify-center shrink-0 animate-fade-in">\n            {isLogoImageUrl(store?.logo) ? (\n              <img src={store!.logo} className="w-full h-full object-cover" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />\n            ) : (\n              <div className="w-full h-full bg-[#1A1C1E] flex flex-col items-center justify-center text-white">\n                <span className="material-symbols-outlined text-[#FFD23F] text-3xl font-bold">shopping_cart</span>\n                <span className="text-xs font-black tracking-wider uppercase mt-1">{store?.business_name?.slice(0, 3)}</span>\n              </div>\n            )}\n          </div>`;
const newLogo = `<div className="absolute -top-16 w-32 h-32 rounded-full border-4 border-white bg-white shadow-xl overflow-hidden flex items-center justify-center shrink-0 animate-fade-in">\n            <StoreBrandMark store={store} />\n          </div>`;
if (!text.includes(oldLogo)) throw new Error('Exact storefront logo block not found');
text = text.replace(oldLogo, newLogo);

fs.writeFileSync(file, text);
