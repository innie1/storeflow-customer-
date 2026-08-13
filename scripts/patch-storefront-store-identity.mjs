import fs from 'node:fs';

const file = 'src/App.tsx';
let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
let changed = false;

// This script is intentionally limited to storefront identity presentation.
// Catalog loading must remain runtime code, not build-time source rewriting.
const oldType = `    const storeType = store?.category || 'Grocery Store';`;
const newType = `    const rawStoreType = store?.data?.businessTemplate?.type || store?.data?.storeType || store?.data?.retailType || store?.category || '';\n    const STORE_TYPE_LABELS = { grocery: 'Grocery Store', provision: 'Provision Store', supermarket: 'Supermarket', laundry: 'Laundry', barber: 'Barber Shop', salon: 'Salon', tailoring: 'Tailoring', repair: 'Repair', printing: 'Printing', cyber_cafe: 'Cyber Cafe', car_wash: 'Car Wash', photography: 'Photography', cleaning: 'Cleaning', spa: 'Spa', restaurant: 'Restaurant', bakery: 'Bakery', pharmacy: 'Pharmacy', electronics: 'Electronics', gas_filling: 'Gas Station', games: 'Games & Entertainment', gaming: 'Gaming', retail: 'Retail Store' };\n    const storeType = STORE_TYPE_LABELS[String(rawStoreType).toLowerCase()] || (rawStoreType ? String(rawStoreType).replace(/_/g, ' ') : 'Business');`;
if (text.includes(oldType)) { text = text.replace(oldType, newType); changed = true; }

const oldName = `{store?.business_name || 'StoreFlow Store'}`;
const newName = `{store?.business_name || store?.data?.storeName || store?.data?.businessName || 'Store'}`;
if (text.includes(oldName)) { text = text.replaceAll(oldName, newName); changed = true; }

if (changed) fs.writeFileSync(file, text);
console.log(`[StoreFlow] storefront identity ${changed ? 'applied' : 'already applied'}; catalog untouched.`);
