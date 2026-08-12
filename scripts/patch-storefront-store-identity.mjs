import fs from 'node:fs';

const file = 'src/App.tsx';
let text = fs.readFileSync(file, 'utf8');
let changed = false;

// Never let an old/global catalog survive while a newly scanned store is resolving.
const oldLoad = `    setProductsLoading(!hasInstantData);\n    setErrorText(null);`;
const newLoad = `    // A new QR/deep-link must start with an empty catalog. Never show products\n    // cached for another store while the scanned store is being resolved.\n    setProducts([]);\n    setCategories(['All']);\n    setSelectedCategory('All');\n    setProductsLoading(true);\n    try { localStorage.removeItem('storeflow_cached_products'); } catch {}\n    setErrorText(null);`;
if (text.includes(oldLoad)) { text = text.replace(oldLoad, newLoad); changed = true; }
text = text.replace(`    const hasInstantData = !!cachedMatch;\n`, '');

// The public store record is authoritative. Only use per-store cache for the exact store.
const oldCache = `      const cachedProducts = localStorage.getItem('storeflow_cached_products_' + cachedMatch.id);\n      if (cachedProducts) {\n        try { setProducts(JSON.parse(cachedProducts)); } catch {}\n      }`;
const newCache = `      const cachedProducts = localStorage.getItem('storeflow_cached_products_' + cachedMatch.id);\n      if (cachedProducts) {\n        try {\n          const parsed = JSON.parse(cachedProducts);\n          if (Array.isArray(parsed) && parsed.every((p) => String(p.store_id || '') === String(cachedMatch.id))) setProducts(parsed);\n        } catch {}\n      }`;
if (text.includes(oldCache)) { text = text.replace(oldCache, newCache); changed = true; }

// Use the business template as the source of truth for the storefront type.
const oldType = `    const storeType = store?.category || 'Grocery Store';`;
const newType = `    const rawStoreType = store?.data?.businessTemplate?.type || store?.data?.storeType || store?.data?.retailType || store?.category || '';\n    const STORE_TYPE_LABELS = {\n      grocery: 'Grocery Store', provision: 'Provision Store', supermarket: 'Supermarket', laundry: 'Laundry', barber: 'Barber Shop', salon: 'Salon', tailoring: 'Tailoring', repair: 'Repair', printing: 'Printing', cyber_cafe: 'Cyber Cafe', car_wash: 'Car Wash', photography: 'Photography', cleaning: 'Cleaning', spa: 'Spa', restaurant: 'Restaurant', bakery: 'Bakery', pharmacy: 'Pharmacy', electronics: 'Electronics', gas_filling: 'Gas Station', games: 'Games & Entertainment', gaming: 'Gaming', retail: 'Retail Store'\n    };\n    const storeType = STORE_TYPE_LABELS[String(rawStoreType).toLowerCase()] || (rawStoreType ? String(rawStoreType).replace(/_/g, ' ') : 'Business');`;
if (text.includes(oldType)) { text = text.replace(oldType, newType); changed = true; }

// Store logo can be a merchant-selected style name (not only an image URL).
const oldLogo = `{isLogoImageUrl(store?.logo) ? (\n              <img src={store!.logo} className="w-full h-full object-cover" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />\n            ) : (`;
const newLogo = `{isLogoImageUrl(store?.logo) ? (\n              <img src={store!.logo} className="w-full h-full object-cover" alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />\n            ) : (\n              <div className="w-full h-full bg-[#1A1C1E] flex flex-col items-center justify-center text-white">\n                <span className="material-symbols-outlined text-[#FFD23F] text-3xl font-bold">{store?.logo === 'modern' ? 'storefront' : store?.logo === 'minimal' ? 'shopping_bag' : store?.logo === 'classic' ? 'store' : store?.logo === 'bold' ? 'business' : 'storefront'}</span>\n                <span className="text-[10px] font-black tracking-wider uppercase mt-1">{String(store?.business_name || store?.data?.storeName || 'Store').slice(0, 10)}</span>\n              </div>\n            )}`;
if (text.includes(oldLogo)) { text = text.replace(oldLogo, newLogo); changed = true; }

// Make the displayed store name resilient to the canonical JSONB name as well.
const oldName = `{store?.business_name || 'StoreFlow Store'}`;
const newName = `{store?.business_name || store?.data?.storeName || store?.data?.businessName || 'Store'}`;
if (text.includes(oldName)) { text = text.replaceAll(oldName, newName); changed = true; }

// Do not write a global product cache; it is unsafe for cross-store navigation.
text = text.replace(`        localStorage.setItem('storeflow_cached_products', JSON.stringify(prods));\n`, '');

if (changed) fs.writeFileSync(file, text);
console.log(`[StoreFlow] storefront identity/catalog hardening ${changed ? 'applied' : 'already applied'}.`);
