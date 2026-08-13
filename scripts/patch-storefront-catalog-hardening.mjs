import fs from 'node:fs';

const file = 'src/App.tsx';
let text = fs.readFileSync(file, 'utf8');
let changed = false;

// Remove the unsafe global product/category cache restore completely.
for (const pattern of [
  /\s*const cachedProducts = localStorage\.getItem\(['"]storeflow_cached_products['"]\);\s*/g,
  /\s*const cachedCategories = localStorage\.getItem\(['"]storeflow_cached_categories['"]\);\s*/g,
  /\s*if \(cachedProducts\)\s*setProducts\(JSON\.parse\(cachedProducts\)\);\s*/g,
  /\s*if \(cachedCategories\)\s*setCategories\(JSON\.parse\(cachedCategories\)\);\s*/g,
]) {
  const next = text.replace(pattern, '\n');
  if (next !== text) { text = next; changed = true; }
}

const oldSelect = `.select('id, store_id, category_id, barcode, qr_code, sku, name, description, brand, selling_price, quantity, minimum_stock, maximum_stock, unit, image, expiry_date, status, created_at, updated_at, restock_count, units_sold, total_revenue, first_sale_at, last_sold_at, is_service')`;
const newSelect = `.select('id, store_id, category_id, barcode, qr_code, sku, name, description, brand, selling_price, quantity, unit, image, status, is_service')`;
if (text.includes(oldSelect)) { text = text.replace(oldSelect, newSelect); changed = true; }

const oldJsonPrice = `const whPrice = p.sellingPrice ?? p.selling_price ?? 0;`;
const newJsonPrice = `const whPrice = Number(p.sellingPrice ?? p.selling_price ?? p.price ?? 0);`;
if (text.includes(oldJsonPrice)) { text = text.replace(oldJsonPrice, newJsonPrice); changed = true; }

const oldServiceUnit = `unit: o.pricing === 'time' ? 'session' : 'service',`;
const newServiceUnit = `unit: o.pricing === 'time' ? 'session' : (o.unit || o.pricing || 'service'),`;
if (text.includes(oldServiceUnit)) { text = text.replace(oldServiceUnit, newServiceUnit); changed = true; }

for (const pattern of [
  /\s*localStorage\.setItem\(['"]storeflow_cached_products['"],\s*JSON\.stringify\(prods\)\);\s*/g,
  /\s*localStorage\.setItem\(['"]storeflow_cached_categories['"],\s*JSON\.stringify\(cats\)\);\s*/g,
]) {
  const next = text.replace(pattern, '\n');
  if (next !== text) { text = next; changed = true; }
}

if (/storeflow_cached_products|storeflow_cached_categories/.test(text)) {
  throw new Error('[StoreFlow] Unsafe global catalog cache reference remains in App.tsx');
}

if (changed) fs.writeFileSync(file, text);
console.log(`[StoreFlow] catalog hardening ${changed ? 'applied' : 'already applied'}.`);
