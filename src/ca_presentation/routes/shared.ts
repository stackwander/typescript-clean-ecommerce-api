import type { RequestHandler } from 'express';
import { objectId } from '../schemas';
export const id = (value: unknown) => objectId.parse(value);
export const route =
  (path: string): RequestHandler =>
  (_req, res, next) => {
    res.locals.routeTemplate = path;
    next();
  };
