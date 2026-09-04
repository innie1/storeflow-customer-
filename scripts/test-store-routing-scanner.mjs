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
expectContains(app, 'useState<Store[]>(readCachedStores)', 'external deep links hydrate the verified store cache before routing');
expectContains(app, 'if (!event && initialRouteHandledRef.current) return;', 'external camera routes are not replayed during startup');
expectContains(app, 'matchesPublicStoreReference(activeStoreRef.current, sid)', 'a transient refresh cannot evict the verified active store');
expectContains(app, "const matched = allStores.find(s => matchesPublicStoreReference(s, sid)) || (", 'a catalog-load error retains successfully resolved store metadata');
expectContains(app, "setErrorText('Showing the saved store while the connection refreshes.')", 'retained deep links surface a non-destructive refresh notice');
expectContains(app, 'ms.enabled === false', 'empty marketplace settings do not incorrectly close a store');
expectContains(app, 'ms.storeOpen === false', 'the merchant open/closed switch is honored');
expectContains(app, "safeSetJSON('storeflow_cached_all_stores', data)", 'large store discovery caches cannot crash mobile storage');
expectContains(app, "safeGetItem('storeflow_cached_products_' + cachedMatch.id)", 'cached deep-link catalogs tolerate unavailable mobile storage');
expectContains(app, "safeSetJSON('storeflow_cached_products_' + resolvedStoreUuid, prods)", 'catalog cache writes cannot turn successful store loads into offline failures');
if (app.includes("localStorage.setItem('storeflow_cached_all_stores'")) throw new Error('large discovery cache must use quota-safe storage');
if (app.includes("selling_price, wholesale_price, retail_price")) throw new Error('product query must only request columns present in Supabase');
if (app.includes("allStores?.[0]?.id")) throw new Error('orders must never fall back to a different discovered store');

// This used to assert that `prebuild` still ran patch-store-routing-scanner.mjs.
// That script's output has long since been committed to src/App.tsx, so the
// prebuild chain rewrote the working tree on every single build to produce
// bytes that were already there. The assertions above check the behaviour the
// patch was there to guarantee, which is the thing that actually matters —
// asserting on the build step as well only pinned a no-op in place.
expectContains(app, '// STOREFLOW_SHARED_STORE_RESOLVER_V1', 'the shared public store resolver is wired into the customer app');
expectContains(app, 'const cachedMatch = allStores.find((s: any) => matchesPublicStoreReference(s, sid));', 'cached store lookups go through the shared reference matcher');
expectContains(app, 'const { store: storeData, error: storeErr } = await resolvePublicStore(sid);', 'store detail loads resolve through the shared public resolver');
if (!String(pkg.scripts?.test || '').includes('test-store-routing-scanner.mjs')) throw new Error('npm test must include scanner/store-routing regressions');

console.log('Store routing/scanner regressions passed.');
