import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { fixture, config } from '../helpers';
import * as schemas from '../../src/ca_presentation/schemas';
import { assertTransition } from '../../src/ca_application/orders';
import { loadConfig } from '../../src/config';

test('configuration fails closed without distinct credentials and reports no values', () => {
  assert.throws(() => loadConfig({}), /Invalid configuration/);
  assert.throws(
    () =>
      loadConfig({
        ...config,
        PORT: '3000',
        RATE_LIMIT_MAX: '120',
        API_ADMIN_KEY: config.API_READ_KEY,
      }),
    /distinct/,
  );
});
test('validation rejects privileged/unknown fields, invalid IDs, empty and duplicate items', () => {
  assert.equal(schemas.userUpdate.safeParse({ password: 'secret' }).success, false);
  assert.equal(schemas.productUpdate.safeParse({ quantityInStock: 100 }).success, false);
  assert.equal(schemas.customerUpdate.safeParse({}).success, false);
  assert.equal(schemas.pagination.safeParse({ limit: 101 }).success, false);
  assert.equal(schemas.objectId.safeParse('not-an-id').success, false);
  assert.equal(
    schemas.orderCreate.safeParse({ customerId: 'a'.repeat(24), total: 1, orderItems: [] }).success,
    false,
  );
  const item = { productId: 'a'.repeat(24), quantity: 1 };
  assert.equal(
    schemas.orderCreate.safeParse({ customerId: 'b'.repeat(24), orderItems: [item, item] }).success,
    false,
  );
  assert.equal(schemas.orderUpdate.safeParse({ orderItems: [] }).success, false);
});
test('payment and order lifecycle invariants', () => {
  assert.throws(
    () => assertTransition({ status: 'pending', paid: false }, { status: 'shipped' }),
    /payment/,
  );
  assert.throws(
    () => assertTransition({ status: 'pending', paid: true }, { status: 'cancelled' }),
    /refund/,
  );
  assert.throws(
    () =>
      assertTransition(
        { status: 'pending', paid: true },
        { orderItems: [{ productId: 'a'.repeat(24), quantity: 1 }] },
      ),
    /refund/,
  );
  assert.throws(
    () => assertTransition({ status: 'cancelled', paid: false }, { status: 'pending' }),
    /cannot change/,
  );
  assert.doesNotThrow(() =>
    assertTransition({ status: 'pending', paid: false }, { paid: true, status: 'shipped' }),
  );
});
test('API authenticates direct access and separates read, write and admin permissions', async () => {
  const { app, register } = fixture();
  try {
    await request(app).get('/api/product').expect(401);
    await request(app)
      .post('/api/product')
      .set('x-api-key', config.API_READ_KEY)
      .send({})
      .expect(403);
    await request(app).get('/api/user').set('x-api-key', config.API_WRITE_KEY).expect(403);
    await request(app)
      .put(`/api/order/${'a'.repeat(24)}`)
      .set('x-api-key', config.API_WRITE_KEY)
      .send({ paid: true })
      .expect(403);
    await request(app).get('/health/live').expect(200);
    await request(app).get('/metrics').expect(404);
  } finally {
    register.clear();
  }
});
test('validated output, rather than raw input, reaches persistence', async () => {
  let input: unknown;
  const { app, register } = fixture({
    createCustomer: async (value) => {
      input = value;
      return {
        ...value,
        customerCode: 'a'.repeat(24),
        creationDate: new Date(),
        modificationDate: new Date(),
      };
    },
  });
  try {
    await request(app)
      .post('/api/customer')
      .set('x-api-key', config.API_WRITE_KEY)
      .send({
        customerName: ' Alice ',
        cemail: 'ALICE@example.com',
        phone: '1',
        address: 'a',
        city: 'c',
        postalCode: 'p',
        country: 'US',
      })
      .expect(201);
    assert.deepEqual(input, {
      customerName: 'Alice',
      cemail: 'alice@example.com',
      phone: '1',
      address: 'a',
      city: 'c',
      postalCode: 'p',
      country: 'US',
    });
  } finally {
    register.clear();
  }
});
test('customer-order route forwards the actual customer ID and bounded pagination', async () => {
  let received: unknown;
  const { app, register } = fixture(
    {},
    {
      list: async (page, customerId) => {
        received = { page, customerId };
        return { ...page, total: 0, items: [] };
      },
    },
  );
  try {
    await request(app)
      .get(`/api/order/customer/${'a'.repeat(24)}?limit=5`)
      .set('x-api-key', config.API_READ_KEY)
      .expect(200);
    assert.deepEqual(received, { page: { offset: 0, limit: 5 }, customerId: 'a'.repeat(24) });
  } finally {
    register.clear();
  }
});
test('logs omit request bodies and credentials, and metrics aggregate by route template', async () => {
  const { app, register, events } = fixture(
    {},
    {
      get: async () => {
        throw new Error('private-driver-content');
      },
    },
  );
  try {
    for (const id of ['a'.repeat(24), 'b'.repeat(24)]) {
      const result = await request(app)
        .get(`/api/order/${id}?private=query-secret`)
        .set('x-api-key', config.API_READ_KEY)
        .expect(500);
      assert.equal(JSON.stringify(result.body).includes('private-driver-content'), false);
      assert.ok(result.headers['x-request-id']);
    }
    const data = await register.metrics();
    assert.ok(data.includes('route="/api/order/:id"'));
    const serialized = JSON.stringify(events);
    for (const secret of [config.API_READ_KEY, 'query-secret', 'private-driver-content'])
      assert.equal(serialized.includes(secret), false);
  } finally {
    register.clear();
  }
});
test('JSON errors, body limits, CORS preflight and readiness draining are handled', async () => {
  const { app, register, drain } = fixture();
  try {
    await request(app)
      .post('/api/customer')
      .set('x-api-key', config.API_WRITE_KEY)
      .set('Content-Type', 'application/json')
      .send('{bad')
      .expect(400);
    await request(app)
      .post('/api/customer')
      .set('x-api-key', config.API_WRITE_KEY)
      .send({ text: 'x'.repeat(140000) })
      .expect(413);
    const cors = await request(app)
      .options('/api/product')
      .set('Origin', 'https://example.com')
      .set('Access-Control-Request-Method', 'POST')
      .expect(204);
    assert.equal(cors.headers['access-control-allow-origin'], 'https://example.com');
    drain();
    await request(app).get('/health/ready').expect(503);
  } finally {
    register.clear();
  }
});
