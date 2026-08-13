import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src/App.tsx');
let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

// Keep customer analytics inside the existing JSON notes payload. This keeps
// checkout compatible with the current place_order_atomic RPC instead of
// adding unsupported RPC arguments/database columns.
const marker = "const notes = JSON.stringify({\n      delivery_type:";
const replacement = "const notes = JSON.stringify({\n      customer_uuid: itsMeProfile?.customerId || null,\n      is_guest: !currentUser,\n      delivery_type:";

if (!text.includes('customer_uuid: itsMeProfile?.customerId')) {
  if (!text.includes(marker)) {
    throw new Error('Customer analytics patch target not found: notes payload');
  }
  text = text.replace(marker, replacement);
}

if (!text.includes('customer_uuid: itsMeProfile?.customerId')) {
  throw new Error('Customer analytics patch did not apply');
}

fs.writeFileSync(file, text);
