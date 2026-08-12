import fs from 'node:fs';

const file = 'src/App.tsx';
let text = fs.readFileSync(file, 'utf8');
const invalid = 'const STORE_PUBLIC_COLUMNS = \'id, store_id, business_name, business_type, currency, country, state, city, address, phone, email, logo, subscription_status, data, access_code, qr_code\';';
const valid = 'const STORE_PUBLIC_COLUMNS = \'id, store_id, business_name, currency, country, state, city, address, phone, email, logo, subscription_status, data, access_code, qr_code\';';
if (text.includes(invalid)) {
  text = text.replace(invalid, valid);
  fs.writeFileSync(file, text);
  console.log('[StoreFlow] Removed unsupported business_type column from stores_public query.');
}
