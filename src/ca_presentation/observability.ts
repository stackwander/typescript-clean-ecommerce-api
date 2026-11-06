import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';
import type { RequestHandler } from 'express';
export interface Log {
  info(message: string, metadata: object): void;
  error(message: string, metadata: object): void;
}
export function observability(log: Log) {
  const register = new Registry();
  collectDefaultMetrics({ register });
  const duration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP completion latency in seconds',
    labelNames: ['method', 'route', 'code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
    registers: [register],
  });
  const middleware: RequestHandler = (req, res, next) => {
    const requestId = randomUUID();
    const start = performance.now();
    res.locals.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    res.on('finish', () => {
      const seconds = (performance.now() - start) / 1000;
      const route =
        res.locals.routeTemplate ??
        (req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched');
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(
        req.method,
      )
        ? req.method
        : 'OTHER';
      duration.observe({ method, route, code: res.statusCode }, seconds);
      log.info('HTTP request completed', {
        requestId,
        method,
        route,
        status: res.statusCode,
        durationMs: Math.round(seconds * 1000),
      });
    });
    next();
  };
  return { register, middleware };
}
