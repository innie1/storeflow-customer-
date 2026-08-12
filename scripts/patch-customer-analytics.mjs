import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve('src/App.tsx');
let text = fs.readFileSync(file, 'utf8');

const replacements = [
  {
    from: "customer_phone: finalCustomerPhone,\n      order_number: genOrderNo,",
    to: "customer_phone: finalCustomerPhone,\n      customer_uuid: itsMeProfile?.customerId || null,\n      is_guest: !currentUser,\n      order_number: genOrderNo,"
  },
  {
    from: "p_customer_phone: orderPayload.customer_phone,\n        p_order_number: genOrderNo,",
    to: "p_customer_phone: orderPayload.customer_phone,\n        p_customer_uuid: orderPayload.customer_uuid || null,\n        p_is_guest: orderPayload.is_guest ?? true,\n        p_order_number: genOrderNo,"
  },
  {
    from: "p_customer_phone: orderData.order.customer_phone,\n          p_order_number: orderData.order.order_number,",
    to: "p_customer_phone: orderData.order.customer_phone,\n          p_customer_uuid: orderData.order.customer_uuid || null,\n          p_is_guest: orderData.order.is_guest ?? true,\n          p_order_number: orderData.order.order_number,"
  }
];

for (const { from, to } of replacements) {
  if (!text.includes(from)) throw new Error(`Customer analytics patch target not found: ${from.slice(0, 80)}`);
  text = text.replace(from, to);
}

if (!text.includes('customer_uuid: itsMeProfile?.customerId')) throw new Error('Customer analytics patch did not apply');
fs.writeFileSync(file, text);
