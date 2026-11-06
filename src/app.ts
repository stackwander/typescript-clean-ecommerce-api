import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Config } from './config';
import type { CatalogRepository } from './ca_domain/ports';
import { AppError } from './ca_domain/errors';
import { OrderService } from './ca_application/orders';
import { createCatalogRouter } from './ca_presentation/routes/catalog';
import { createOrdersRouter } from './ca_presentation/routes/orders';
import { createUsersRouter } from './ca_presentation/routes/users';
import { authenticate } from './ca_presentation/security';
import { observability, type Log } from './ca_presentation/observability';
import { errorHandler } from './ca_presentation/errors';

export type Dependencies = {
  config: Config;
  catalog: CatalogRepository;
  orders: OrderService;
  ready: () => Promise<void>;
  log: Log;
};
export function createApp({ config, catalog, orders, ready, log }: Dependencies) {
  const app = express();
  const metrics = observability(log);
  let draining = false;
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(metrics.middleware, helmet());
  const origins = new Set(config.CORS_ORIGINS.split(',').filter(Boolean));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !!origin && origins.has(origin)),
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'x-api-key', 'Idempotency-Key'],
      exposedHeaders: ['x-request-id'],
    }),
  );
  app.get('/health/live', (_req, res) => {
    res.json({ status: 'alive' });
  });
  app.get('/health/ready', async (_req, res) => {
    if (draining) throw new AppError(503, 'UNAVAILABLE', 'Server is shutting down');
    try {
      await ready();
    } catch {
      throw new AppError(503, 'UNAVAILABLE', 'Database is unavailable');
    }
    res.json({ status: 'ready' });
  });
  app.use(
    '/api',
    rateLimit({
      windowMs: 60000,
      limit: config.RATE_LIMIT_MAX,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests')),
    }),
    authenticate(config),
    express.json({ limit: '128kb', inflate: false }),
  );
  app.use(
    '/api',
    createCatalogRouter(catalog),
    createOrdersRouter(orders),
    createUsersRouter(catalog),
  );
  app.use((_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found')));
  app.use(errorHandler(log));
  return {
    app,
    register: metrics.register,
    drain: () => {
      draining = true;
    },
  };
}
