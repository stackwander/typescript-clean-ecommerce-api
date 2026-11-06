import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Explicitly opt in: this script creates records in the supplied development stack.
const base = process.env.SMOKE_BASE_URL;
if (!base || process.env.SMOKE_ALLOW_WRITES !== 'true') {
  throw new Error(
    'Set SMOKE_BASE_URL and SMOKE_ALLOW_WRITES=true for a disposable development stack',
  );
}
for (const name of ['API_READ_KEY', 'API_WRITE_KEY', 'API_ADMIN_KEY']) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}
async function call(path, { key, method = 'GET', body, retryKey, expected = 200 } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(key ? { 'x-api-key': key } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(retryKey ? { 'Idempotency-Key': retryKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal(response.status, expected, `${method} ${path}`);
  return response.status === 204 ? null : response.json();
}
await call('/health/ready');
await call('/api/product', { expected: 401 });
const write = process.env.API_WRITE_KEY;
const read = process.env.API_READ_KEY;
const unique = randomUUID();
const customer = await call('/api/customer', {
  key: write,
  method: 'POST',
  expected: 201,
  body: {
    customerName: 'Smoke',
    cemail: `${unique}@example.com`,
    phone: '1',
    address: 'Road',
    city: 'City',
    postalCode: '123',
    country: 'US',
  },
});
const product = await call('/api/product', {
  key: write,
  method: 'POST',
  expected: 201,
  body: {
    productName: 'Smoke widget',
    productvendor: 'Smoke',
    productDescription: 'Disposable',
    quantityInStock: 3,
    buyPrice: 100,
    msrp: 250,
  },
});
const input = {
  customerId: customer.customerCode,
  orderItems: [{ productId: product.productCode, quantity: 2 }],
};
const order = await call('/api/order', {
  key: write,
  method: 'POST',
  expected: 201,
  body: input,
  retryKey: unique,
});
assert.equal(order.total, 500);
const replay = await call('/api/order', {
  key: write,
  method: 'POST',
  expected: 201,
  body: input,
  retryKey: unique,
});
assert.equal(replay.orderId, order.orderId);
const list = await call(`/api/order/customer/${customer.customerCode}`, { key: read });
assert.equal(list.items.length, 1);
await call(`/api/order/${order.orderId}`, {
  key: write,
  method: 'PUT',
  body: { paid: true },
  expected: 403,
});
await call(`/api/order/${order.orderId}`, { key: write, method: 'DELETE', expected: 204 });
const stock = await call(`/api/product/${product.productCode}`, { key: read });
assert.equal(stock.quantityInStock, 3);
await call(`/api/product/${product.productCode}`, { key: write, method: 'DELETE', expected: 409 });
console.log(
  'Gateway smoke passed: credentials, POST/PUT/DELETE routing, order replay, totals and restored inventory',
);
