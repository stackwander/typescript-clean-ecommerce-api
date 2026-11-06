import type { CatalogRepository, OrderRepository } from '../src/ca_domain/ports';
import { loadConfig } from '../src/config';
import { OrderService } from '../src/ca_application/orders';
import { createApp } from '../src/app';
export const config = loadConfig({
  NODE_ENV: 'test',
  MONGODB_URL: 'mongodb://localhost/shop_test',
  API_READ_KEY: 'r'.repeat(40),
  API_WRITE_KEY: 'w'.repeat(40),
  API_ADMIN_KEY: 'a'.repeat(40),
  RATE_LIMIT_MAX: '10000',
  CORS_ORIGINS: 'https://example.com',
});
export function fixture(
  overrides: Partial<CatalogRepository> = {},
  orderOverrides: Partial<OrderRepository> = {},
) {
  const events: object[] = [];
  const unexpected = () => {
    throw new Error('Unexpected persistence call');
  };
  const catalog = new Proxy(overrides, {
    get: (target, key) => Reflect.get(target, key) ?? unexpected,
  }) as CatalogRepository;
  const repository = new Proxy(orderOverrides, {
    get: (target, key) => Reflect.get(target, key) ?? unexpected,
  }) as OrderRepository;
  const log = {
    info: (_message: string, metadata: object) => {
      events.push(metadata);
    },
    error: (_message: string, metadata: object) => {
      events.push(metadata);
    },
  };
  return {
    ...createApp({
      config,
      catalog,
      orders: new OrderService(repository, 'USD'),
      ready: async () => {},
      log,
    }),
    events,
  };
}
