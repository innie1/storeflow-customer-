import fs from 'node:fs';

function read(path) {
  return fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
}

function expectContains(text, needle, label) {
  if (!text.includes(needle)) throw new Error(`${label}: missing ${needle}`);
}

const resolver = read('src/utils/storeResolver.ts');
const patch = read('scripts/patch-store-routing-scanner.mjs');
const pkg = JSON.parse(read('package.json'));
const router = read('src/router.ts');

expectContains(resolver, "supabase.rpc('get_public_storefront'", 'shared resolver uses public RPC');
expectContains(resolver, "if (isUuid(key)) candidates.push(['id', key]);", 'UUID lookup is type-safe');
expectContains(resolver, "candidates.push(['access_code', noSf]);", 'six-character access code fallback exists');
expectContains(resolver, 'profile?.uniqueCode', 'cached legacy store alias is recognized');
if (resolver.includes('.or(`id.eq.${')) throw new Error('resolver must never mix a text store code into a UUID OR filter');

expectContains(patch, 'resolvePublicStore(sid)', 'deep-link load uses shared resolver');
expectContains(patch, 'resolvePublicStore(parsedStoreId)', 'scanner uses shared resolver');
expectContains(patch, 'setShowScanner(true);', 'unrecognized scan keeps manual recovery visible');
expectContains(patch, "e.key === 'Enter'", 'manual store entry supports keyboard Enter');
expectContains(patch, 'Find Store', 'manual store entry has a visible Find Store action');

expectContains(router, "root === 's' || root === 'store'", 'router accepts store deep-link paths');
expectContains(router, 'decodeQRData(s)', 'router accepts encoded StoreFlow QR tokens');

if (!String(pkg.scripts?.prebuild || '').includes('patch-store-routing-scanner.mjs')) {
  throw new Error('prebuild must run the scanner/store-routing patch');
}
if (!String(pkg.scripts?.test || '').includes('test-store-routing-scanner.mjs')) {
  throw new Error('npm test must include scanner/store-routing regressions');
}

console.log('Store routing/scanner regressions passed.');
