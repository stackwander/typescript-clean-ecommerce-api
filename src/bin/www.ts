import 'dotenv/config';
import http from 'node:http';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../config';
import { createApp } from '../app';
import { PrismaCatalog } from '../ca_infrastructure/database/catalog';
import { PrismaOrders } from '../ca_infrastructure/database/orders';
import { OrderService } from '../ca_application/orders';
import { logger } from '../ca_infrastructure/logging/logger';
import { assertDatabaseContract } from '../ca_infrastructure/database/contract';

async function main() {
  const config = loadConfig();
  const db = new PrismaClient({ datasources: { db: { url: config.MONGODB_URL } } });
  await db.$connect();
  try {
    await assertDatabaseContract(db);
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
  const { app, register, drain } = createApp({
    config,
    catalog: new PrismaCatalog(db),
    orders: new OrderService(new PrismaOrders(db), config.CURRENCY),
    ready: async () => {
      await db.$runCommandRaw({ ping: 1 });
    },
    log: logger,
  });
  const server = http.createServer(app);
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  // Private listener: never published by Compose or routed through Kong.
  const metrics = http.createServer(async (req, res) => {
    if (req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    try {
      res.setHeader('Content-Type', register.contentType);
      res.end(await register.metrics());
    } catch {
      res.writeHead(500).end();
    }
  });
  server.listen(config.PORT, '0.0.0.0', () => logger.info('API listening', { port: config.PORT }));
  metrics.listen(9464, '0.0.0.0');
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    drain();
    const timer = setTimeout(() => process.exit(1), 20000).unref();
    await Promise.all([
      new Promise<void>((resolve) => server.close(() => resolve())),
      new Promise<void>((resolve) => metrics.close(() => resolve())),
    ]);
    await db.$disconnect();
    register.clear();
    clearTimeout(timer);
  };
  server.on('error', () => {
    logger.error('HTTP listener failed', {});
    void shutdown().finally(() => process.exit(1));
  });
  metrics.on('error', () => {
    logger.error('Metrics listener failed', {});
    void shutdown().finally(() => process.exit(1));
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      void shutdown();
    });
}
void main().catch(() => {
  logger.error('Startup failed; check configuration and database connectivity', {});
  process.exit(1);
});
