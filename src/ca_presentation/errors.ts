import type { ErrorRequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../ca_domain/errors';
import type { Log } from './observability';
export function errorHandler(log: Log): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) return next(error);
    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: { field: string; message: string }[] | undefined;
    if (error instanceof AppError) ({ status, code, message } = error);
    else if (error instanceof ZodError) {
      status = 400;
      code = 'INVALID_INPUT';
      message = 'Request validation failed';
      details = error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped: Record<string, [number, string, string]> = {
        P2002: [409, 'CONFLICT', 'A unique value is already in use'],
        P2003: [409, 'CONFLICT', 'Resource is still referenced'],
        P2014: [409, 'CONFLICT', 'Resource is still referenced'],
        P2025: [404, 'NOT_FOUND', 'Resource not found'],
        P2023: [400, 'INVALID_INPUT', 'Invalid database identifier'],
        P2034: [409, 'CONFLICT', 'Concurrent change; retry the request'],
        P2024: [503, 'UNAVAILABLE', 'Database is temporarily unavailable'],
      };
      [status, code, message] = mapped[error.code] ?? [500, code, message];
    } else if (typeof error === 'object' && error !== null && 'type' in error) {
      if (error.type === 'entity.parse.failed') {
        status = 400;
        code = 'INVALID_JSON';
        message = 'Malformed JSON';
      }
      if (error.type === 'entity.too.large') {
        status = 413;
        code = 'BODY_TOO_LARGE';
        message = 'JSON body exceeds 128 KiB';
      }
      if (error.type === 'encoding.unsupported') {
        status = 415;
        code = 'UNSUPPORTED_ENCODING';
        message = 'Send uncompressed JSON';
      }
    }
    // Never log raw driver errors: they can contain query arguments or connection details.
    if (status >= 500)
      log.error('Request failed', {
        requestId: res.locals.requestId,
        code,
        errorType: error instanceof Error ? error.name : 'Unknown',
      });
    res.status(status).json({
      error: { code, message, ...(details ? { details } : {}) },
      requestId: res.locals.requestId,
    });
  };
}
