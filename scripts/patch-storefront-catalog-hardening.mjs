import fs from 'node:fs';

const file = 'src/App.tsx';
let text = fs.readFileSync(file, 'utf8');
let changed = false;

// Never hydrate a store page from the old global catalog. Keep the declarations
// out of the transformed source AND remove their global restore calls. The
// previous patch removed only the declarations, leaving references behind and
// causing the production TypeScript build to fail.
const globalCacheBlock = /\s*const cachedProducts = localStorage\.getItem\('storeflow_cached_products'\);\s*const cachedCategories = localStorage\.getItem\('storeflow_cached_categories'\);\s*\n\s*if \(cachedProducts\) setProducts\(JSON\.parse\(cachedProducts\)\);\s*if \(cachedCategories\) setCategories\(JSON\.parse\(cachedCategories\)\);/;
if (globalCacheBlock.test(text)) {
  text = text.replace(globalCacheBlock, '\n    // Product/category state is restored only by the active store-scoped catalog loader.');
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

const oldJsonPrice = `const whPrice = p.sellingPrice ?? p.selling_price ?? 0;`;
const newJsonPrice = `const whPrice = Number(p.sellingPrice ?? p.selling_price ?? p.price ?? 0);`;
if (text.includes(oldJsonPrice)) {
  text = text.replace(oldJsonPrice, newJsonPrice);
  changed = true;
}

const oldServiceUnit = `unit: o.pricing === 'time' ? 'session' : 'service',`;
const newServiceUnit = `unit: o.pricing === 'time' ? 'session' : (o.unit || o.pricing || 'service'),`;
if (text.includes(oldServiceUnit)) {
  text = text.replace(oldServiceUnit, newServiceUnit);
  changed = true;
}

// Never write unsafe global product/category caches. Store-scoped caches remain
// the offline fallback and are written by the active store loader.
for (const statement of [
  `        localStorage.setItem('storeflow_cached_products', JSON.stringify(prods));\n`,
  `        localStorage.setItem('storeflow_cached_categories', JSON.stringify(cats));\n`,
]) {
  if (text.includes(statement)) {
    text = text.replace(statement, '');
    changed = true;
  }
}

if (changed) fs.writeFileSync(file, text);
console.log(`[StoreFlow] catalog hardening ${changed ? 'applied' : 'already applied'}.`);
