import fs from 'node:fs';

const path = 'src/App.tsx';
let source = fs.readFileSync(path, 'utf8');

const start = source.indexOf('      let storeData = null;\n      let storeErr = null;\n      let queryUsed = \'\';', source.indexOf('const loadStoreDetails = async'));
const endMarker = '      // 4. Return and log the full Supabase response and any errors.\n';
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  throw new Error('[StoreFlow] Could not find loadStoreDetails resolver block; refusing to patch.');
}

const replacement = `      let storeData = null;\n      let storeErr = null;\n      let queryUsed = '';\n\n      const cleanSid = sid.trim();\n      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cleanSid);\n      const normalizedCode = cleanSid.replace(/^SF-/i, 'SF-').toUpperCase();\n\n      // New devices have no local store cache, so store resolution must work\n      // entirely from the public storefront data. Avoid a single large OR\n      // filter: PostgREST can cast/parse one bad branch of an OR expression\n      // and reject the entire request. Resolve using the strongest identifier\n      // first, then safe fallbacks.\n      const tryStoreLookup = async (column, value) => {\n        const res = await supabase\n          .from('stores_public')\n          .select(STORE_PUBLIC_COLUMNS)\n          .eq(column, value)\n          .maybeSingle();\n        if (res.error) throw res.error;\n        return res.data;\n      };\n\n      try {\n        if (isUuid) {\n          queryUsed = 'stores_public.id';\n          storeData = await tryStoreLookup('id', cleanSid);\n        }\n\n        if (!storeData) {\n          queryUsed = 'stores_public.store_id';\n          storeData = await tryStoreLookup('store_id', normalizedCode);\n        }\n\n        if (!storeData && !/^SF-/i.test(cleanSid)) {\n          queryUsed = 'stores_public.store_id (SF- fallback)';\n          storeData = await tryStoreLookup('store_id', \\`SF-\\${cleanSid.toUpperCase()}\\`);\n        }\n\n        if (!storeData) {\n          queryUsed = 'stores_public.access_code';\n          storeData = await tryStoreLookup('access_code', cleanSid.toUpperCase());\n        }\n\n        if (!storeData) {\n          queryUsed = 'stores_public.qr_code';\n          const res = await supabase\n            .from('stores_public')\n            .select(STORE_PUBLIC_COLUMNS)\n            .ilike('qr_code', \\`%\\${cleanSid}%\\`)\n            .limit(1);\n          if (res.error) throw res.error;\n          storeData = res.data?.[0] || null;\n        }\n      } catch (lookupError) {\n        storeErr = lookupError;\n      }\n`;

source = source.slice(0, start) + replacement + source.slice(end);
fs.writeFileSync(path, source);
console.log('[StoreFlow] New-device store resolver hardened: id -> store_id -> access_code -> qr_code.');
