import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler, Response } from 'express';
import { AppError } from '../ca_domain/errors';
import type { Config } from '../config';
export type Access = 'read' | 'write' | 'admin';
export const hasAccess = (res: Response, level: Access) => {
  const ranks = { read: 1, write: 2, admin: 3 };
  return ranks[res.locals.access as Access] >= ranks[level];
};
export function authenticate(config: Config): RequestHandler {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  const keys = [
    { access: 'read', hash: hash(config.API_READ_KEY) },
    { access: 'write', hash: hash(config.API_WRITE_KEY) },
    { access: 'admin', hash: hash(config.API_ADMIN_KEY) },
  ];
  return (req, res, next) => {
    const supplied = hash(req.get('x-api-key') ?? '');
    let access: string | undefined;
    for (const key of keys) if (timingSafeEqual(supplied, key.hash)) access = key.access;
    if (!access) throw new AppError(401, 'UNAUTHORIZED', 'A valid x-api-key is required');
    res.locals.access = access;
    next();
  };
}
export function authorize(level: Access): RequestHandler {
  return (_req, res, next) => {
    if (!hasAccess(res, level)) throw new AppError(403, 'FORBIDDEN', `${level} access is required`);
    next();
  };
}
