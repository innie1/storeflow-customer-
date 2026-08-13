import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src/components/ServiceBusinessExperience.tsx');
let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const marker = '// STOREFLOW_SERVICE_FLOW_V2';
// The customer component now contains the complete service flow itself. Keep this
// legacy compatibility patch harmless when the modern implementation is present.
if (text.includes(marker) || text.includes('function priceLabel(o: Offering)')) process.exit(0);

const oldTypes = "const SERVICE_TYPES = new Set(['laundry','barber','salon','tailoring','repair','printing','cyber_cafe','car_wash','photography','cleaning','spa','games','gaming','games_entertainment']);";
const newTypes = `const SERVICE_TYPES = new Set(['laundry','laundr','barber','salon','tailoring','repair','printing','cyber_cafe','car_wash','photography','cleaning','spa','games','gaming','games_entertainment','gaming_centre','gaming_center']);\n\n${marker}\nfunction normalizeBusinessType(value: unknown): string {\n  const raw = String(value ?? '').trim().toLowerCase().replace(/[-\\s]+/g, '_');\n  const aliases: Record<string, string> = {\n    laundr: 'laundry', laundry_service: 'laundry', laundry_services: 'laundry',\n    barber_shop: 'barber', barbing_salon: 'barber', beauty_salon: 'salon',\n    fashion_design: 'tailoring', tailor: 'tailoring', repair_shop: 'repair',\n    cybercafe: 'cyber_cafe', cyber_cafe_business: 'cyber_cafe', carwash: 'car_wash',\n    photo_studio: 'photography', cleaning_service: 'cleaning', spa_wellness: 'spa',\n    gaming_centre: 'gaming', gaming_center: 'gaming', games_entertainment: 'games_entertainment',\n  };\n  return aliases[raw] || raw;\n}\nfunction serviceTemplate(store: StoreRecord | null): any {\n  const d = store?.data || {};\n  return d.businessTemplate || d.business_template || d.serviceTemplate || d.service_template || {};\n}\nfunction serviceProducts(store: StoreRecord | null): any[] {\n  const d = store?.data || {};\n  const lists = [d.products, d.services, d.serviceProducts, d.service_products];\n  for (const list of lists) {\n    if (Array.isArray(list)) return list;\n  }\n  return [];\n}\nfunction isServiceProduct(p: any): boolean {\n  return Boolean(p && (p.isService === true || p.is_service === true || p.type === 'service' || p.kind === 'service') && p.discontinued !== true && p.deleted !== true);\n}`;
if (!text.includes(oldTypes)) throw new Error('service type declaration not found');
text = text.replace(oldTypes, newTypes);

const oldBusinessType = "function businessType(store: StoreRecord) { return String(store.data?.businessTemplate?.type || store.data?.storeType || store.data?.businessType || '').toLowerCase(); }";
const newBusinessType = `function businessType(store: StoreRecord) {\n  const d = store.data || {};\n  const t = serviceTemplate(store);\n  return normalizeBusinessType(t.type || t.businessType || t.storeType || d.storeType || d.businessType || d.business_type || d.businessCategory || '');\n}`;
if (!text.includes(oldBusinessType)) throw new Error('businessType function not found');
text = text.replace(oldBusinessType, newBusinessType);

const oldTemplate = "const type=store?businessType(store):''; const template=store?.data?.businessTemplate||{}; const offerings=useMemo<Offering[]>(()=> (Array.isArray(template.offerings)?template.offerings:[]).filter(isEnabledOffering),[template]);\n const hasServiceProducts=Array.isArray(store?.data?.products) && store!.data.products.some((p:any)=>p?.isService===true && p?.discontinued!==true);\n const isServiceStore=SERVICE_TYPES.has(type)||Boolean(template?.modes?.includes?.('services'))||offerings.length>0||hasServiceProducts;";
const newTemplate = `const type=store?businessType(store):'';\n const template=serviceTemplate(store);\n const offerings=useMemo<Offering[]>(()=>{\n   const configured=Array.isArray(template?.offerings)?template.offerings.filter(isEnabledOffering):[];\n   if(configured.length) return configured;\n   return serviceProducts(store).filter(isServiceProduct).map((p:any)=>({\n     id:String(p.id), name:String(p.name||'Service'), description:p.description||'',\n     price:Number(p.sellingPrice ?? p.selling_price ?? p.price ?? 0),\n     sellingPrice:Number(p.sellingPrice ?? p.selling_price ?? p.price ?? 0),\n     pricing:'fixed', turnaround:p.turnaround || p.turnaroundTime || p.turnaround_time || '',\n     enabled:true, active:true, discontinued:false,\n   }));\n },[store,template]);\n const hasServiceProducts=serviceProducts(store).some(isServiceProduct);\n const modeValues=Array.isArray(template?.modes)?template.modes.map((m:any)=>String(m).toLowerCase()):[];\n const isServiceStore=SERVICE_TYPES.has(type)||modeValues.includes('services')||modeValues.includes('service')||offerings.length>0||hasServiceProducts;`;
if (!text.includes(oldTemplate)) throw new Error('service detection block not found');
text = text.replace(oldTemplate, newTemplate);

fs.writeFileSync(file, text);
