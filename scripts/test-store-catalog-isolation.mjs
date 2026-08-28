import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

assert.match(source, /const requestId = \+\+storeLoadRequestRef\.current;[\s\S]*?setProducts\(\[\]\);[\s\S]*?setCategories\(\['All'\]\);/,
  'switching stores must clear the previous merchant catalog immediately');
assert.match(source, /if \(requestId !== storeLoadRequestRef\.current\) return;/,
  'late store requests must be ignored');
assert.match(source, /String\(product\.store_id \|\| ''\) === String\(storeUuid\)/,
  'every product must belong to the resolved store');
assert.match(source, /!serviceBusiness \|\| product\.isService === true/,
  'service stores must reject retail inventory');
assert.match(source, /storeflow_cached_products_' \+ resolvedStoreUuid/,
  'catalog cache must be namespaced by store UUID');
assert.doesNotMatch(source, /setItem\('storeflow_cached_products',/,
  'the unsafe global product cache must not be written');

console.log('Store catalog isolation regressions passed.');
