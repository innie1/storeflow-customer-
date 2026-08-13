import fs from 'node:fs';

const file = 'src/App.tsx';
let source = fs.readFileSync(file, 'utf8');
let changed = false;

const globalCacheBlock = `    const cachedProducts = localStorage.getItem('storeflow_cached_products');\n    const cachedCategories = localStorage.getItem('storeflow_cached_categories');\n`;
const globalCacheUse = `    if (cachedProducts) setProducts(JSON.parse(cachedProducts));\n    if (cachedCategories) setCategories(JSON.parse(cachedCategories));\n`;
if (source.includes(globalCacheBlock)) { source = source.replace(globalCacheBlock, ''); changed = true; }
if (source.includes(globalCacheUse)) { source = source.replace(globalCacheUse, ''); changed = true; }

const oldSelect = "'id, store_id, category_id, barcode, qr_code, sku, name, description, brand, selling_price, quantity, minimum_stock, maximum_stock, unit, image, expiry_date, status, created_at, updated_at, restock_count, units_sold, total_revenue, first_sale_at, last_sold_at, is_service'";
const newSelect = "'id, store_id, category_id, barcode, name, description, brand, selling_price, wholesale_price, retail_price, quantity, unit, image, status, is_service'";
if (source.includes(oldSelect)) { source = source.replace(oldSelect, newSelect); changed = true; }

const oldCatch = `      if (matched) {\n        setStore(matched);\n        setProducts([]);\n        setLoading(false);\n      } else {`;
const newCatch = `      if (matched) {\n        setStore(matched);\n        const cached = localStorage.getItem('storeflow_cached_products_' + matched.id);\n        if (cached) {\n          try { setProducts(JSON.parse(cached)); } catch { /* keep current catalog */ }\n        }\n        setLoading(false);\n      } else {`;
if (source.includes(oldCatch)) { source = source.replace(oldCatch, newCatch); changed = true; }

const oldOrderCatch = `    } catch (e: any) {\n      // Genuine failure after retries — don't lose the order. Queue it for\n      // background sync instead of just showing an error and giving up.\n      console.error('Order placement failed after retries, queueing for background sync:', e);\n      queueOrderForOfflineSync(orderPayload, itemsPayload);\n      setOrderSubmitting(false);\n      setOrderSubmitError("We're having trouble reaching the store right now — your order has been saved and will send automatically once your connection improves.");\n    }`;
const newOrderCatch = `    } catch (e: any) {\n      console.error('Order placement failed:', e);\n      setOrderSubmitting(false);\n      if (!navigator.onLine) {\n        queueOrderForOfflineSync(orderPayload, itemsPayload);\n        setOrderSubmitError("You're offline. Your order is saved and will send automatically when your connection returns.");\n      } else {\n        const message = e?.message || e?.details || e?.hint || 'The store could not accept the order right now.';\n        setOrderSubmitError(message);\n        setOrderStatus('Order Failed');\n        setOrderId(null);\n      }\n    }`;
if (source.includes(oldOrderCatch)) { source = source.replace(oldOrderCatch, newOrderCatch); changed = true; }

// Fresh devices cannot rely on allStores/localStorage. Resolve a scanned store
// using one identifier at a time instead of a large PostgREST OR expression.
// The existing isUuid declaration above this block is intentionally reused.
const resolverStartMarker = "      let storeData = null;\n      let storeErr = null;\n      let queryUsed = '';";
const resolverEndMarker = '      // 4. Return and log the full Supabase response and any errors.\n';
const resolverStart = source.indexOf(resolverStartMarker, source.indexOf('const loadStoreDetails = async'));
const resolverEnd = source.indexOf(resolverEndMarker, resolverStart);
if (resolverStart !== -1 && resolverEnd !== -1) {
  const resolverReplacement = [
    "      let storeData = null;",
    "      let storeErr = null;",
    "      const cleanSid = sid.trim();",
    "      const normalizedCode = cleanSid.toUpperCase();",
    "",
    "      const lookupStore = async (column: string, value: string) => {",
    "        const res = await supabase.from('stores_public').select(STORE_PUBLIC_COLUMNS).eq(column, value).maybeSingle();",
    "        if (res.error) throw res.error;",
    "        return res.data;",
    "      };",
    "",
    "      try {",
    "        if (isUuid) storeData = await lookupStore('id', cleanSid);",
    "        if (!storeData) storeData = await lookupStore('store_id', normalizedCode);",
    "        if (!storeData && !normalizedCode.startsWith('SF-')) storeData = await lookupStore('store_id', 'SF-' + normalizedCode);",
    "        if (!storeData) storeData = await lookupStore('access_code', normalizedCode.replace(/^SF-/, ''));",
    "        if (!storeData) {",
    "          const res = await supabase.from('stores_public').select(STORE_PUBLIC_COLUMNS).ilike('qr_code', '%' + cleanSid + '%').limit(1);",
    "          if (res.error) throw res.error;",
    "          storeData = res.data?.[0] || null;",
    "        }",
    "      } catch (lookupError) {",
    "        storeErr = lookupError;",
    "      }",
    ""
  ].join('\n');
  source = source.slice(0, resolverStart) + resolverReplacement + source.slice(resolverEnd);
  changed = true;
}

if (changed) fs.writeFileSync(file, source);
console.log(`[StoreFlow] runtime stability patch ${changed ? 'applied' : 'already present'}.`);
