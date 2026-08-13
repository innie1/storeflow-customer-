import fs from 'node:fs';

const file = 'src/App.tsx';
let source = fs.readFileSync(file, 'utf8');
let changed = false;

// Never hydrate the active catalog from the old global cache. It can belong to
// a different store and is only useful as legacy data for migration/debugging.
const globalCacheBlock = `    const cachedProducts = localStorage.getItem('storeflow_cached_products');\n    const cachedCategories = localStorage.getItem('storeflow_cached_categories');\n`;
const globalCacheUse = `    if (cachedProducts) setProducts(JSON.parse(cachedProducts));\n    if (cachedCategories) setCategories(JSON.parse(cachedCategories));\n`;
if (source.includes(globalCacheBlock)) {
  source = source.replace(globalCacheBlock, '');
  changed = true;
}
if (source.includes(globalCacheUse)) {
  source = source.replace(globalCacheUse, '');
  changed = true;
}

// The customer app only needs these stable product columns. Requesting merchant
// analytics/restock columns made the entire catalog fail when one optional
// column was absent from a deployment schema.
const oldSelect = "'id, store_id, category_id, barcode, qr_code, sku, name, description, brand, selling_price, quantity, minimum_stock, maximum_stock, unit, image, expiry_date, status, created_at, updated_at, restock_count, units_sold, total_revenue, first_sale_at, last_sold_at, is_service'";
const newSelect = "'id, store_id, category_id, barcode, name, description, brand, selling_price, wholesale_price, retail_price, quantity, unit, image, status, is_service'";
if (source.includes(oldSelect)) {
  source = source.replace(oldSelect, newSelect);
  changed = true;
}

// Do not wipe a valid catalog when a refresh/query fails. Keep the store-specific
// cache already rendered, and only show the offline message when there is no data.
const oldCatch = `      if (matched) {\n        setStore(matched);\n        setProducts([]);\n        setLoading(false);\n      } else {`;
const newCatch = `      if (matched) {\n        setStore(matched);\n        const cached = localStorage.getItem('storeflow_cached_products_' + matched.id);\n        if (cached) {\n          try { setProducts(JSON.parse(cached)); } catch { /* keep current catalog */ }\n        }\n        setLoading(false);\n      } else {`;
if (source.includes(oldCatch)) {
  source = source.replace(oldCatch, newCatch);
  changed = true;
}

// Online database failures must not be mislabeled as offline. Queue only when
// the browser is actually offline; otherwise show the real RPC error so a
// broken order cannot disappear into an endless background queue.
const oldOrderCatch = `    } catch (e: any) {\n      // Genuine failure after retries — don't lose the order. Queue it for\n      // background sync instead of just showing an error and giving up.\n      console.error('Order placement failed after retries, queueing for background sync:', e);\n      queueOrderForOfflineSync(orderPayload, itemsPayload);\n      setOrderSubmitting(false);\n      setOrderSubmitError("We're having trouble reaching the store right now — your order has been saved and will send automatically once your connection improves.");\n    }`;
const newOrderCatch = `    } catch (e: any) {\n      console.error('Order placement failed:', e);\n      setOrderSubmitting(false);\n      if (!navigator.onLine) {\n        queueOrderForOfflineSync(orderPayload, itemsPayload);\n        setOrderSubmitError("You're offline. Your order is saved and will send automatically when your connection returns.");\n      } else {\n        const message = e?.message || e?.details || e?.hint || 'The store could not accept the order right now.';\n        setOrderSubmitError(message);\n        setOrderStatus('Order Failed');\n        setOrderId(null);\n      }\n    }`;
if (source.includes(oldOrderCatch)) {
  source = source.replace(oldOrderCatch, newOrderCatch);
  changed = true;
}

if (changed) fs.writeFileSync(file, source);
console.log(`[StoreFlow] runtime stability patch ${changed ? 'applied' : 'already present'}.`);
