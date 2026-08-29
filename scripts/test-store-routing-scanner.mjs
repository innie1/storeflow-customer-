import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function expectContains(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}

const resolver = read('src/utils/storeResolver.ts');
const patch = read('scripts/patch-store-routing-scanner.mjs');
const plugin = read('vite-plugin-store-discovery.ts');
const pkg = JSON.parse(read('package.json'));
const router = read('src/router.ts');
const vite = read('vite.config.ts');
const main = read('src/main.tsx');
const app = read('src/App.tsx');

expectContains(resolver, "supabase.rpc('get_public_storefront'", 'shared resolver uses public RPC');
expectContains(resolver, "supabase.rpc('list_public_storefronts'", 'store discovery uses the public listing RPC');
expectContains(resolver, 'profile?.uniqueCode', 'cached legacy store alias is recognized');
if (resolver.includes("from('stores_public')")) throw new Error('customer resolver must not bypass the safe public RPCs');
if (resolver.includes('.or(`id.eq.${')) throw new Error('resolver must never mix a text store code into a UUID OR filter');

expectContains(patch, 'resolvePublicStore(sid)', 'deep-link load uses shared resolver');
expectContains(patch, 'resolvePublicStore(parsedStoreId)', 'scanner uses shared resolver');
expectContains(patch, 'setShowScanner(true);', 'unrecognized scan keeps manual recovery visible');
expectContains(patch, "e.key === 'Enter'", 'manual store entry supports keyboard Enter');
expectContains(patch, 'Find Store', 'manual store entry has a visible Find Store action');

expectContains(router, "root === 's' || root === 'store'", 'router accepts store deep-link paths');
expectContains(router, 'decodeQRData(s)', 'router accepts encoded StoreFlow QR tokens');
expectContains(router, "url.searchParams.get('storeId') || url.searchParams.get('store') || url.searchParams.get('code')", 'scanner accepts QR URLs with query store codes');
expectContains(router, "from './utils/storeResolver'", 'router uses the canonical shared resolver');

expectContains(plugin, 'openStoreFromSearch', 'home/manual store search has a real resolver action');
expectContains(plugin, 'Search Store</span>', 'home search exposes a visible Search Store action');
expectContains(plugin, "resolvePublicStore(parsedStoreId)", 'runtime scanner transform uses canonical resolver');
expectContains(plugin, "void openStoreFromSearch(value)", 'manual scanner entry resolves directly');
expectContains(vite, 'customerStoreDiscoveryPlugin()', 'store discovery transform is enabled before React');

expectContains(main, "updateViaCache: 'none'", 'installed PWA bypasses stale HTTP cache when checking sw.js');
expectContains(main, 'await reg.update()', 'installed PWA explicitly checks for a new worker');
expectContains(main, "document.visibilityState === 'visible'", 'installed PWA rechecks when resumed');
expectContains(main, "window.addEventListener('online'", 'installed PWA rechecks after reconnecting');
expectContains(main, "navigator.serviceWorker.addEventListener('controllerchange'", 'installed PWA reloads after worker takeover');
if (main.includes('ServiceBusinessExperience')) throw new Error('legacy service overlay must not be mounted beside the unified app');

expectContains(app, "if (newScreen === 'store') return;", 'store navigation waits for a resolved identity');
expectContains(app, "window.history.pushState(historyState, '', targetPath);", 'opening a different store preserves the prior history entry');
expectContains(app, "stateScreen && stateScreen !== 'store'", 'store history entries are re-resolved on back/forward');
expectContains(app, "event?.state?.storeId || event?.state?.storeRef || route.storeId", 'store history persists a canonical resolver key');
expectContains(app, 'ms.enabled === false', 'empty marketplace settings do not incorrectly close a store');
expectContains(app, 'ms.autoScheduleEnabled !== true', 'business hours only close stores when schedule automation is enabled');
if (app.includes("selling_price, wholesale_price, retail_price")) throw new Error('product query must only request columns present in Supabase');
if (app.includes("allStores?.[0]?.id")) throw new Error('orders must never fall back to a different discovered store');

if (!String(pkg.scripts?.prebuild || '').includes('patch-store-routing-scanner.mjs')) throw new Error('prebuild must run the scanner/store-routing patch');
if (!String(pkg.scripts?.test || '').includes('test-store-routing-scanner.mjs')) throw new Error('npm test must include scanner/store-routing regressions');

console.log('Store routing/scanner regressions passed.');
