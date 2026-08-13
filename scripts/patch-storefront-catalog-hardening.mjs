import fs from 'node:fs';

const file = 'src/App.tsx';
let text = fs.readFileSync(file, 'utf8');
let changed = false;

// Never hydrate a store page from the old global catalog. That catalog can belong
// to another store and is especially dangerous after QR/deep-link navigation.
const globalCacheLoad = `    const cachedProducts = localStorage.getItem('storeflow_cached_products');\n    const cachedCategories = localStorage.getItem('storeflow_cached_categories');\n`;
const globalCacheLoadReplacement = `    // Product/catalog state is store-scoped. Do not restore a global catalog here.\n`;
if (text.includes(globalCacheLoad)) {
  text = text.replace(globalCacheLoad, globalCacheLoadReplacement);
  changed = true;
}

// The catalog query must only request columns that the customer storefront
// actually uses. One nonexistent/merchant-only column makes Supabase return
// an error for the entire query, which previously left both products and
// services blank even though the store itself loaded correctly.
const oldSelect = `.select('id, store_id, category_id, barcode, qr_code, sku, name, description, brand, selling_price, quantity, minimum_stock, maximum_stock, unit, image, expiry_date, status, created_at, updated_at, restock_count, units_sold, total_revenue, first_sale_at, last_sold_at, is_service')`;
const newSelect = `.select('id, store_id, category_id, barcode, qr_code, sku, name, description, brand, selling_price, quantity, unit, image, status, is_service')`;
if (text.includes(oldSelect)) {
  text = text.replace(oldSelect, newSelect);
  changed = true;
}

// JSONB catalogs are supported, but normalize service/product price fields
// consistently so both kinds of business can render and be ordered.
const oldJsonPrice = `const whPrice = p.sellingPrice ?? p.selling_price ?? 0;`;
const newJsonPrice = `const whPrice = Number(p.sellingPrice ?? p.selling_price ?? p.price ?? 0);`;
if (text.includes(oldJsonPrice)) {
  text = text.replace(oldJsonPrice, newJsonPrice);
  changed = true;
}

// A service may be represented as an offering instead of a relational product.
// Preserve its explicit unit/pricing mode for the customer UI.
const oldServiceUnit = `unit: o.pricing === 'time' ? 'session' : 'service',`;
const newServiceUnit = `unit: o.pricing === 'time' ? 'session' : (o.unit || o.pricing || 'service'),`;
if (text.includes(oldServiceUnit)) {
  text = text.replace(oldServiceUnit, newServiceUnit);
  changed = true;
}

// Never write the unsafe global product/category caches. Keep only the exact
// store-scoped cache so offline reopening still works without cross-store data.
const globalProductWrite = `        localStorage.setItem('storeflow_cached_products', JSON.stringify(prods));\n`;
if (text.includes(globalProductWrite)) {
  text = text.replace(globalProductWrite, '');
  changed = true;
}
const globalCategoryWrite = `        localStorage.setItem('storeflow_cached_categories', JSON.stringify(cats));\n`;
if (text.includes(globalCategoryWrite)) {
  text = text.replace(globalCategoryWrite, '');
  changed = true;
}

if (changed) fs.writeFileSync(file, text);
console.log(`[StoreFlow] catalog hardening ${changed ? 'applied' : 'already applied'}.`);
