import type { Plugin } from 'vite';

const APP = '/src/App.tsx';

export function patchCustomerStoreDiscovery(source: string): string {
  let code = source;

  const routerImport = "import { parseRoute, parseQRCode } from './router';";
  const resolverImport = "import { resolvePublicStore } from './utils/storeResolver';";
  if (!code.includes(resolverImport)) {
    if (!code.includes(routerImport)) throw new Error('[store-discovery] router import anchor missing');
    code = code.replace(routerImport, `${routerImport}\n${resolverImport}`);
  }

  if (!code.includes('const openStoreFromSearch = async')) {
    const processAnchor = '  const processScannedCode = async (codeValue: string) => {';
    if (!code.includes(processAnchor)) throw new Error('[store-discovery] scanner anchor missing');
    const helper = `  const openStoreFromSearch = async (raw: string) => {\n    const query = raw.trim();\n    if (!query) return false;\n    setLoading(true);\n    setErrorText(null);\n    try {\n      const resolved = await resolvePublicStore(query);\n      if (!resolved.store) {\n        setScanError('Store not found. Check the Store ID or access code and try again.');\n        return false;\n      }\n      setStoreId(resolved.store.id);\n      await loadStoreDetails(resolved.store.id);\n      setSearchQuery('');\n      setShowManualInput(false);\n      navigateToScreen('store');\n      return true;\n    } catch (error) {\n      console.error('Store lookup failed', error);\n      setScanError('Could not search for that store right now. Check your connection and try again.');\n      return false;\n    } finally {\n      setLoading(false);\n    }\n  };\n\n`;
    code = code.replace(processAnchor, helper + processAnchor);
  }

  const unsafeScanner = /          let storeData = null;\n          let storeErr = null;\n\n          if \(parsedStoreId\.toUpperCase\(\)\.startsWith\('SF-'\)\) \{[\s\S]*?          if \(!storeData && !storeErr\) \{[\s\S]*?            storeErr = res\.error;\n          \}\n\n          if \(storeData\) \{/;
  if (unsafeScanner.test(code)) {
    code = code.replace(unsafeScanner, `          const { store: storeData, error: storeErr } = await resolvePublicStore(parsedStoreId);\n          if (storeErr && !storeData) console.warn('[StoreFlow] store scan resolver warning', storeErr);\n\n          if (storeData) {`);
  } else if (!code.includes('resolvePublicStore(parsedStoreId)')) {
    throw new Error('[store-discovery] scanner resolver wiring missing');
  }

  const homeInput = `                value={searchQuery}\n                onChange={e => setSearchQuery(e.target.value)}\n              />`;
  const homeInputPatched = `                value={searchQuery}\n                onChange={e => setSearchQuery(e.target.value)}\n                onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim()) { e.preventDefault(); void openStoreFromSearch(searchQuery); } }}\n              />`;
  if (code.includes(homeInput)) code = code.replace(homeInput, homeInputPatched);

  const scannerButton = `              <button \n                onClick={startScanner} \n                className="w-8 h-8 rounded-full bg-gray-50 dark:bg-zinc-800 flex items-center justify-center text-gray-400 dark:text-zinc-300 hover:text-[#1A1C1E] dark:hover:text-white active:scale-95 transition-all shrink-0 cursor-pointer"\n                title="Scan Barcode"\n              >`;
  if (code.includes(scannerButton) && !code.includes('Search Store</span>')) {
    const findButton = `              {searchQuery.trim() && (\n                <button\n                  type="button"\n                  onClick={() => void openStoreFromSearch(searchQuery)}\n                  className="h-8 px-3 rounded-full bg-[#1A1C1E] dark:bg-[#FFD23F] text-[#FFD23F] dark:text-[#1A1C1E] text-[10px] font-black whitespace-nowrap active:scale-95 transition-all"\n                  title="Search store by ID or access code"\n                >\n                  <span>Search Store</span>\n                </button>\n              )}\n`;
    code = code.replace(scannerButton, findButton + scannerButton.replace('title="Scan Barcode"', 'title="Scan Store QR Code"'));
  }

  const manualAction = `                      setShowManualInput(false);\n                      processScannedCode(manualInputVal.trim());\n                      setManualInputVal('');`;
  if (code.includes(manualAction)) {
    code = code.replace(manualAction, `                      const value = manualInputVal.trim();\n                      setManualInputVal('');\n                      void openStoreFromSearch(value);`);
  }

  return code;
}

export default function customerStoreDiscoveryPlugin(): Plugin {
  return {
    name: 'storeflow-customer-store-discovery',
    enforce: 'pre',
    transform(code, id) {
      const normalized = id.split('?')[0].replace(/\\/g, '/');
      if (normalized.endsWith(APP)) return { code: patchCustomerStoreDiscovery(code), map: null };
      return null;
    },
  };
}
