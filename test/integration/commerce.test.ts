import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PrismaCatalog } from '../../src/ca_infrastructure/database/catalog';
import { PrismaOrders } from '../../src/ca_infrastructure/database/orders';
import { OrderService } from '../../src/ca_application/orders';
import { createApp } from '../../src/app';
import { config } from '../helpers';

// Never inherit the application's .env URL or clean an existing application's database.
const source = process.env.TEST_MONGODB_URL;
if (!source)
  throw new Error('Set TEST_MONGODB_URL to a dedicated local replica-set database ending in _test');
const url = new URL(source);
if (!url.pathname.endsWith('_test')) throw new Error('Test database name must end in _test');
const database = `shop_${randomBytes(8).toString('hex')}_test`;
url.pathname = `/${database}`;
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const catalog = new PrismaCatalog(db);
const orders = new OrderService(new PrismaOrders(db), 'USD');
const silent = { info: () => {}, error: () => {} };
const { app, register } = createApp({
  config,
  catalog,
  orders,
  ready: async () => {
    await db.$runCommandRaw({ ping: 1 });
  },
  log: silent,
});
const customerInput = {
  customerName: 'Customer',
  cemail: 'alice@example.com',
  phone: '1',
  address: 'Road',
  city: 'City',
  postalCode: '123',
  country: 'US',
};
let customerId: string;
before(async () => {
  execFileSync(
    process.execPath,
    [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/setup-db.ts'],
    { env: { ...process.env, MONGODB_URL: url.toString() }, stdio: 'pipe' },
  );
  const customer = await catalog.createCustomer(customerInput);
  customerId = customer.customerCode;
});
after(async () => {
  register.clear();
  // The only dropped database has a fresh random name owned by this test process.
  if (url.pathname === `/${database}`) await db.$runCommandRaw({ dropDatabase: 1 });
  await db.$disconnect();
});
const product = (quantityInStock = 10) =>
  catalog.createProduct({
    productName: 'Widget',
    productvendor: 'Vendor',
    productDescription: 'Demo',
    quantityInStock,
    buyPrice: 100,
    msrp: 250,
  });
const input = (productId: string, quantity = 1) => ({
  customerId,
  comments: '',
  orderItems: [{ productId, quantity }],
});
const key = () => randomBytes(12).toString('hex');

test('API validates writes, requires payment authority, and omits legacy passwords', async () => {
  const user = await catalog.createUser({
    username: 'operator',
    email: 'operator@example.com',
    role: 'operator',
    status: 'active',
  });
  await db.$runCommandRaw({
    update: 'User',
    updates: [{ q: { username: 'operator' }, u: { $set: { password: 'legacy-secret' } } }],
  });
  const response = await request(app)
    .get(`/api/user/id/${user.userId}`)
    .set('x-api-key', config.API_ADMIN_KEY)
    .expect(200);
  assert.equal(JSON.stringify(response.body).includes('legacy-secret'), false);
  assert.equal('password' in response.body, false);
  await request(app)
    .put(`/api/user/${user.userId}`)
    .set('x-api-key', config.API_ADMIN_KEY)
    .send({ password: 'new-secret' })
    .expect(400);
  await request(app)
    .get('/api/product/not-an-object-id')
    .set('x-api-key', config.API_READ_KEY)
    .expect(400);
  await request(app)
    .get(`/api/product/${'a'.repeat(24)}`)
    .set('x-api-key', config.API_READ_KEY)
    .expect(404);
  await request(app)
    .post('/api/customer')
    .set('x-api-key', config.API_WRITE_KEY)
    .send(customerInput)
    .expect(409);
});
test('concurrent orders cannot oversell the last available unit', async () => {
  const p = await product(1);
  const results = await Promise.allSettled([
    orders.create(input(p.productCode), key()),
    orders.create(input(p.productCode), key()),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 0);
});
test('failed creation rolls back earlier inventory reservations and writes', async () => {
  const a = await product(5);
  const b = await product(0);
  const retryKey = key();
  await assert.rejects(
    orders.create(
      {
        customerId,
        comments: '',
        orderItems: [
          { productId: a.productCode, quantity: 2 },
          { productId: b.productCode, quantity: 1 },
        ],
      },
      retryKey,
    ),
    /Insufficient stock/,
  );
  assert.equal((await catalog.getProduct(a.productCode)).quantityInStock, 5);
  assert.equal(await db.order.count({ where: { idempotencyKey: retryKey } }), 0);
});
test('concurrent retries create one order and reserve inventory once', async () => {
  const p = await product(10);
  const retryKey = key();
  const [a, b] = await Promise.all([
    orders.create(input(p.productCode, 2), retryKey),
    orders.create(input(p.productCode, 2), retryKey),
  ]);
  assert.equal(a.orderId, b.orderId);
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 8);
  assert.equal(a.total, 500);
  assert.equal('idempotencyKey' in a, false);
  await assert.rejects(orders.create(input(p.productCode, 3), retryKey), /different input/);
});
test('replacement updates return current items and preserve historical unit prices', async () => {
  const p = await product(10);
  const order = await orders.create(input(p.productCode, 2), key());
  await catalog.updateProduct(p.productCode, { msrp: 900, productName: 'Renamed' });
  const updated = await orders.update(order.orderId, {
    orderItems: [{ productId: p.productCode, quantity: 3 }],
  });
  assert.equal(updated.total, 750);
  assert.equal(updated.orderItems[0]?.quantity, 3);
  assert.equal(updated.orderItems[0]?.productName, 'Widget');
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 7);
  const empty = await request(app)
    .put(`/api/order/${order.orderId}`)
    .set('x-api-key', config.API_WRITE_KEY)
    .send({ orderItems: [] })
    .expect(400);
  assert.equal(empty.body.error.code, 'INVALID_INPUT');
});
test('failed replacement rolls back item deletion and inventory release', async () => {
  const p = await product(5);
  const unavailable = await product(0);
  const order = await orders.create(input(p.productCode, 2), key());
  await assert.rejects(
    orders.update(order.orderId, {
      orderItems: [{ productId: unavailable.productCode, quantity: 1 }],
    }),
    /Insufficient stock/,
  );
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 3);
  const unchanged = await orders.get(order.orderId);
  assert.equal(unchanged.orderItems[0]?.productId, p.productCode);
  assert.equal(unchanged.total, 500);
});
test('soft deletion restores stock once and retains retry and reference history', async () => {
  const p = await product(10);
  const retryKey = key();
  const order = await orders.create(input(p.productCode, 2), retryKey);
  await orders.delete(order.orderId);
  await assert.rejects(orders.delete(order.orderId), /not found/);
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 10);
  const replay = await orders.create(input(p.productCode, 2), retryKey);
  assert.ok(replay.deletedAt);
  assert.equal(replay.orderId, order.orderId);
  await assert.rejects(catalog.deleteProduct(p.productCode), /history/);
  await assert.rejects(catalog.deleteCustomer(customerId), /history/);
});
test('payment and shipping require admin; cancellation releases only unpaid reservations', async () => {
  const p = await product(5);
  const order = await orders.create(input(p.productCode), key());
  await request(app)
    .put(`/api/order/${order.orderId}`)
    .set('x-api-key', config.API_WRITE_KEY)
    .send({ paid: true })
    .expect(403);
  await request(app)
    .put(`/api/order/${order.orderId}`)
    .set('x-api-key', config.API_ADMIN_KEY)
    .send({ status: 'shipped' })
    .expect(409);
  await request(app)
    .put(`/api/order/${order.orderId}`)
    .set('x-api-key', config.API_ADMIN_KEY)
    .send({ paid: true, status: 'shipped' })
    .expect(200);
  await assert.rejects(orders.delete(order.orderId), /unpaid/);
  const cancel = await orders.create(input(p.productCode), key());
  await orders.update(cancel.orderId, { status: 'cancelled' });
  await orders.update(cancel.orderId, { status: 'cancelled' });
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 4);
});
test('customer lookup uses the corrected route and list bounds', async () => {
  const response = await request(app)
    .get(`/api/order/customer/${customerId}?limit=2`)
    .set('x-api-key', config.API_READ_KEY)
    .expect(200);
  assert.equal(response.body.limit, 2);
  assert.equal(response.body.items.length, 2);
  assert.ok(response.body.items.every((o: { customerId: string }) => o.customerId === customerId));
  await request(app).get('/api/order?limit=101').set('x-api-key', config.API_READ_KEY).expect(400);
});
test('concurrent product deletion and order creation leave no orphan references', async () => {
  const p = await product(5);
  const [created] = await Promise.allSettled([
    orders.create(input(p.productCode), key()),
    catalog.deleteProduct(p.productCode),
  ]);
  if (created.status === 'fulfilled') {
    assert.ok(await db.product.findUnique({ where: { productCode: p.productCode } }));
  } else {
    assert.equal(await db.orderItem.count({ where: { productId: p.productCode } }), 0);
  }
});
test('concurrent customer deletion and order creation leave no orphan orders', async () => {
  const c = await catalog.createCustomer({ ...customerInput, cemail: `${key()}@example.com` });
  const p = await product(5);
  const [created] = await Promise.allSettled([
    orders.create({ ...input(p.productCode), customerId: c.customerCode }, key()),
    catalog.deleteCustomer(c.customerCode),
  ]);
  if (created.status === 'fulfilled')
    assert.ok(await db.customer.findUnique({ where: { customerCode: c.customerCode } }));
  else assert.equal(await db.order.count({ where: { customerId: c.customerCode } }), 0);
});
test('stock adjustments are bounded deltas and serialize concurrent changes', async () => {
  const p = await product(10);
  await Promise.all([
    catalog.adjustStock(p.productCode, 3),
    catalog.adjustStock(p.productCode, -4),
  ]);
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 9);
  await assert.rejects(catalog.adjustStock(p.productCode, -10), /Stock adjustment/);
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 9);
});
test('overflow totals roll back reservations', async () => {
  const p = await product(5);
  await catalog.updateProduct(p.productCode, { msrp: 1500000000 });
  await assert.rejects(orders.create(input(p.productCode, 2), key()), /total exceeds/);
  assert.equal((await catalog.getProduct(p.productCode)).quantityInStock, 5);
});
test('paid pending orders cannot change prices or quantity without refund confirmation', async () => {
  const p = await product(5);
  const order = await orders.create(input(p.productCode), key());
  await orders.update(order.orderId, { paid: true });
  await assert.rejects(
    orders.update(order.orderId, { orderItems: [{ productId: p.productCode, quantity: 2 }] }),
    /refund/,
  );
  const refunded = await orders.update(order.orderId, {
    paid: false,
    orderItems: [{ productId: p.productCode, quantity: 2 }],
  });
  assert.equal(refunded.total, 500);
  assert.equal(refunded.paid, false);
});
test('guarded setup refuses unversioned records without modifying data', async () => {
  await db.$runCommandRaw({ delete: '_schema', deletes: [{ q: { _id: 'shop' }, limit: 1 }] });
  const before = await db.product.count();
  try {
    assert.throws(() =>
      execFileSync(
        process.execPath,
        [resolve('node_modules/tsx/dist/cli.mjs'), 'scripts/setup-db.ts'],
        { env: { ...process.env, MONGODB_URL: url.toString() }, stdio: 'pipe' },
      ),
    );
    assert.equal(await db.product.count(), before);
  } finally {
    await db.$runCommandRaw({
      update: '_schema',
      updates: [{ q: { _id: 'shop' }, u: { $set: { version: 2 } }, upsert: true }],
    });
  }
});
