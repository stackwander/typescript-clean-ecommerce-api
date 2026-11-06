import { mkdirSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import * as s from '../src/ca_presentation/schemas';

const timestamp = z.string().datetime();
const customer = s.customerCreate.extend({
  customerCode: s.objectId,
  creationDate: timestamp,
  modificationDate: timestamp,
  revision: z.number().int(),
});
const product = s.productCreate.extend({
  productCode: s.objectId,
  creationDate: timestamp,
  modificationDate: timestamp,
  revision: z.number().int(),
});
const user = s.userCreate.extend({
  userId: s.objectId,
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
const order = z.object({
  orderId: s.objectId,
  customerId: s.objectId,
  orderDate: timestamp,
  shippingDate: timestamp.nullable(),
  status: z.enum(['pending', 'shipped', 'cancelled']),
  comments: z.string(),
  total: z.number().int(),
  currency: z.string(),
  paid: z.boolean(),
  deletedAt: timestamp.nullable(),
  revision: z.number().int(),
  orderItems: z.array(
    z.object({
      orderitemId: s.objectId,
      orderId: s.objectId,
      productId: s.objectId,
      productName: z.string(),
      quantity: z.number().int(),
      unitPrice: z.number().int(),
    }),
  ),
});
const definitions = {
  Customer: customer,
  Product: product,
  User: user,
  Order: order,
  CustomerCreate: s.customerCreate,
  CustomerUpdate: s.customerUpdate,
  ProductCreate: s.productCreate,
  ProductUpdate: s.productUpdate,
  UserCreate: s.userCreate,
  UserUpdate: s.userUpdate,
  OrderCreate: s.orderCreate,
  OrderUpdate: s.orderUpdate,
  StockAdjustment: s.stockAdjustment,
  Error: z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
    }),
    requestId: z.string(),
  }),
};
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ 'application/json': { schema } });
const paths: Record<string, Record<string, object>> = {};
function operation(
  path: string,
  method: string,
  summary: string,
  response: object,
  body?: string,
  list = false,
  access = 'read',
) {
  const parameters: object[] = [...path.matchAll(/\{(\w+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: {
      type: 'string',
      ...(match[1] === 'name'
        ? { minLength: 1, maxLength: 200 }
        : { pattern: '^[a-fA-F0-9]{24}$' }),
    },
  }));
  if (list)
    parameters.push(
      ...['offset', 'limit'].map((name) => ({
        name,
        in: 'query',
        schema: {
          type: 'integer',
          minimum: name === 'limit' ? 1 : 0,
          maximum: name === 'limit' ? 100 : 100000,
          default: name === 'limit' ? 20 : 0,
        },
      })),
    );
  if (path === '/api/order' && method === 'post')
    parameters.push({
      name: 'Idempotency-Key',
      in: 'header',
      required: true,
      schema: { type: 'string', minLength: 8, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' },
    });
  const success =
    method === 'delete' ? '204' : method === 'post' && !path.endsWith('/stock') ? '201' : '200';
  const responses: Record<string, object> = {
    [success]: {
      description: 'Success',
      ...(success !== '204' ? { content: json(response) } : {}),
    },
  };
  for (const status of ['400', '401', '403', '404', '409', '413', '415', '429', '500', '503'])
    responses[status] = {
      description: 'See error.code and README troubleshooting',
      content: json(ref('Error')),
    };
  paths[path] ??= {};
  paths[path][method] = {
    summary,
    description: `Requires ${access} access or higher.`,
    security: [{ apiKey: [] }],
    parameters,
    responses,
    ...(body ? { requestBody: { required: true, content: json(ref(body)) } } : {}),
  };
}
const page = (name: string) => ({
  type: 'object',
  required: ['items', 'total', 'offset', 'limit'],
  properties: {
    items: { type: 'array', items: ref(name) },
    total: { type: 'integer' },
    offset: { type: 'integer' },
    limit: { type: 'integer' },
  },
});
for (const name of ['Customer', 'Product', 'User', 'Order']) {
  const base = `/api/${name.toLowerCase()}`;
  const access = name === 'User' ? 'admin' : 'read';
  operation(base, 'get', `List ${name.toLowerCase()} records`, page(name), undefined, true, access);
  const item = name === 'User' ? `${base}/id/{id}` : `${base}/{id}`;
  operation(item, 'get', `Get ${name.toLowerCase()}`, ref(name), undefined, false, access);
  operation(
    base,
    'post',
    `Create ${name.toLowerCase()}`,
    ref(name),
    `${name}Create`,
    false,
    name === 'User' ? 'admin' : 'write',
  );
  operation(
    `${base}/{id}`,
    'put',
    `Partially update ${name.toLowerCase()}`,
    ref(name),
    `${name}Update`,
    false,
    name === 'User' ? 'admin' : 'write',
  );
  operation(
    `${base}/{id}`,
    'delete',
    `Delete ${name.toLowerCase()}`,
    {},
    undefined,
    false,
    name === 'User' ? 'admin' : 'write',
  );
  if (name !== 'Order')
    operation(
      `${base}/name/{name}`,
      'get',
      `Find ${name.toLowerCase()} by exact name`,
      page(name),
      undefined,
      true,
      access,
    );
}
operation(
  '/api/order/customer/{customerId}',
  'get',
  'List orders for customer',
  page('Order'),
  undefined,
  true,
);
operation(
  '/api/product/{id}/stock',
  'post',
  'Adjust available inventory by a signed delta',
  ref('Product'),
  'StockAdjustment',
  false,
  'write',
);
for (const name of ['live', 'ready'])
  paths[`/health/${name}`] = {
    get: {
      summary: `${name} health check`,
      security: [],
      responses: { '200': { description: 'Healthy' }, '503': { description: 'Not ready' } },
    },
  };
const schemas = Object.fromEntries(
  Object.entries(definitions).map(([name, schema]) => {
    const result = z.toJSONSchema(schema, { target: 'draft-7', io: 'input' });
    delete result.$schema;
    return [name, result];
  }),
);
mkdirSync('docs', { recursive: true });
writeFileSync(
  'docs/openapi.json',
  JSON.stringify(
    {
      openapi: '3.1.0',
      info: {
        title: 'Clean TypeScript Shop API',
        version: '2.0.0',
        description:
          'Trusted integration API. Prices are integer minor units. Payment and shipping changes require admin access. PUT uses partial update semantics. Order creation and replay both return 201; replay may return a deleted tombstone.',
      },
      servers: [{ url: 'http://localhost:8000' }],
      paths,
      components: {
        securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
        schemas,
      },
    },
    null,
    2,
  ) + '\n',
);
