import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src/App.tsx');
let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// STOREFLOW_SHARED_STORE_RESOLVER_V1';

const importAnchor = "import { safeGetItem, safeSetItem, safeGetJSON, safeSetJSON } from './utils/safeStorage';";
const resolverImport = "import { matchesPublicStoreReference, resolvePublicStore } from './utils/storeResolver';";
if (!text.includes(resolverImport)) {
  if (!text.includes(importAnchor)) throw new Error('safeStorage import anchor not found');
  text = text.replace(importAnchor, `${importAnchor}\n${resolverImport}\n${marker}`);
}

// Cached stores must recognize the same aliases as live scans/deep links.
const oldCached = `    const cleanSidForCache = sid.replace(/^SF-/i, '').trim();\n    const cachedMatch = allStores.find((s: any) =>\n      s.id === sid ||\n      s.store_id === sid ||\n      s.access_code === sid ||\n      s.store_id === cleanSidForCache ||\n      s.access_code === cleanSidForCache ||\n      (s.qr_code && typeof s.qr_code === 'string' && s.qr_code.includes(sid))\n    );`;
const newCached = `    const cachedMatch = allStores.find((s: any) => matchesPublicStoreReference(s, sid));`;
if (text.includes(oldCached)) text = text.replace(oldCached, newCached);

// Replace the five separate store queries with the shared public RPC resolver.
const lookupStart = `      let storeData = null;\n      let storeErr = null;\n      const cleanSid = sid.trim();\n      const normalizedCode = cleanSid.toUpperCase();`;
const lookupEnd = `      // 4. Return and log the full Supabase response and any errors.`;
const lookupStartIndex = text.indexOf(lookupStart);
const lookupEndIndex = text.indexOf(lookupEnd, lookupStartIndex);
if (lookupStartIndex >= 0 && lookupEndIndex > lookupStartIndex) {
  const replacement = `      let storeData = null;\n      let storeErr = null;\n      try {\n        const resolved = await resolvePublicStore(sid);\n        storeData = resolved.store;\n        storeErr = resolved.error;\n      } catch (lookupError) {\n        storeErr = lookupError;\n      }\n`;
  text = text.slice(0, lookupStartIndex) + replacement + text.slice(lookupEndIndex);
} else if (!text.includes('const resolved = await resolvePublicStore(sid);')) {
  throw new Error('loadStoreDetails lookup block not found');
}

// The scanner used to put a normal 6-character code into id.eq.<code>, even
// though id is UUID. PostgREST rejects the entire OR before access_code is
// checked. Resolve through the same safe function used by deep links instead.
const scanStart = `          let storeData = null;\n          let storeErr = null;\n\n          if (parsedStoreId.toUpperCase().startsWith('SF-')) {`;
const scanEnd = `          if (storeData) {`;
const scanStartIndex = text.indexOf(scanStart);
const scanEndIndex = text.indexOf(scanEnd, scanStartIndex);
if (scanStartIndex >= 0 && scanEndIndex > scanStartIndex) {
  const replacement = `          const { store: storeData, error: storeErr } = await resolvePublicStore(parsedStoreId);\n          if (storeErr && !storeData) {\n            console.warn('[StoreFlow Scanner] Public store resolution failed:', storeErr);\n          }\n\n`;
  text = text.slice(0, scanStartIndex) + replacement + text.slice(scanEndIndex);
} else if (!text.includes("resolvePublicStore(parsedStoreId)")) {
  throw new Error('scanner store lookup block not found');
}

// stopScanner() intentionally closes the camera after a detected code. If the
// code cannot be resolved, bring the scanner shell back with manual entry open
// instead of silently setting state on an unmounted modal (the old vibrate-then-
// nothing bug).
const unknownFallback = `      // 5. Unrecognized code fallback\n      setScanError(\`Code "\${codeValue}" not recognized in StoreFlow.\`);\n      setShowManualInput(true);`;
const fixedUnknownFallback = `      // 5. Unrecognized code fallback\n      setShowScanner(true);\n      setScanError(\`Code "\${codeValue}" was detected, but no StoreFlow store or product matched it. You can enter the store code below.\`);\n      setShowManualInput(true);`;
if (text.includes(unknownFallback)) text = text.replace(unknownFallback, fixedUnknownFallback);

// Manual entry must have an obvious action and support the keyboard Enter key.
const manualChange = `                onChange={e => setManualInputVal(e.target.value)}\n                className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:border-gray-400 text-xs font-bold text-[#1A1C1E]"\n                placeholder="e.g. freshmart or 5012345678"`;
const manualChangeNew = `                onChange={e => setManualInputVal(e.target.value)}\n                onKeyDown={e => {\n                  if (e.key === 'Enter' && manualInputVal.trim()) {\n                    e.preventDefault();\n                    setShowManualInput(false);\n                    processScannedCode(manualInputVal.trim());\n                    setManualInputVal('');\n                  }\n                }}\n                className="w-full h-12 px-4 bg-gray-50 border border-gray-100 rounded-xl focus:outline-none focus:border-[#FFD23F] text-sm font-black tracking-wider text-[#1A1C1E]"\n                placeholder="Enter store code, e.g. AMZXWE"`;
if (text.includes(manualChange)) text = text.replace(manualChange, manualChangeNew);
text = text.replace('                  Submit\n                </button>', '                  Find Store\n                </button>');
text = text.replace('Enter Store ID or Barcode</h3>', 'Find a Store or Product</h3>');
text = text.replace('Type the Store ID/slug name or a product barcode to open it manually.', 'Enter the 6-character store code, SF store ID, StoreFlow link, or a product barcode.');
text = text.replace('Enter Barcode or ID Manually</span>', 'Enter Store Code Manually</span>');

fs.writeFileSync(file, text);

// The service/laundry overlay used to have its own store lookup, which could
// disagree with App.tsx. Make it use the same public resolver as every other
// entry path.
const serviceFile = path.resolve('src/components/ServiceBusinessExperience.tsx');
let serviceText = fs.readFileSync(serviceFile, 'utf8').replace(/\r\n/g, '\n');
const serviceImportAnchor = "import { parseRoute } from '../router';";
const serviceResolverImport = "import { resolvePublicStore } from '../utils/storeResolver';";
if (!serviceText.includes(serviceResolverImport)) {
  if (!serviceText.includes(serviceImportAnchor)) throw new Error('service storefront import anchor not found');
  serviceText = serviceText.replace(serviceImportAnchor, `${serviceImportAnchor}\n${serviceResolverImport}`);
}

const serviceLookupStart = serviceText.indexOf('async function findPublicStore(identifier: string): Promise<StoreRecord | null> {');
const serviceLookupEnd = serviceText.indexOf('\nexport default function ServiceBusinessExperience()', serviceLookupStart);
if (serviceLookupStart >= 0 && serviceLookupEnd > serviceLookupStart) {
  const replacement = `async function findPublicStore(identifier: string): Promise<StoreRecord | null> {\n  const { store, error } = await resolvePublicStore(identifier);\n  if (error && !store) console.debug('[ServiceBusinessExperience] shared store lookup failed', error);\n  return store as StoreRecord | null;\n}\n`;
  serviceText = serviceText.slice(0, serviceLookupStart) + replacement + serviceText.slice(serviceLookupEnd);
} else if (!serviceText.includes('await resolvePublicStore(identifier)')) {
  throw new Error('service storefront public-store lookup block not found');
}

fs.writeFileSync(serviceFile, serviceText);
