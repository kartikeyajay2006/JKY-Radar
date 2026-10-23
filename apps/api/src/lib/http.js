import { validationFailed } from './errors.js';

/** @import { AppRequest } from '../types.js' */
/** @import { NextFunction, RequestHandler, Response } from 'express' */
/** @import { ZodType, ZodTypeDef } from 'zod' */

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const asyncHandler =
  /**
   * @param {(req: AppRequest, res: Response, next: NextFunction) => Promise<unknown>} fn
   * @returns {RequestHandler}
   */
  (fn) => (req, res, next) => {
    fn(/** @type {AppRequest} */ (req), res, next).catch(next);
  };

/**
 * @template T
 * @param {ZodType<T, ZodTypeDef, unknown>} schema
 * @param {unknown} value
 * @returns {T}
 */
export function parse(schema, value) {
  const r = schema.safeParse(value);
  if (!r.success) {
    throw validationFailed(r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return r.data;
}

/**
 * @template T
 * @param {Response} res
 * @param {T} data
 * @param {unknown} [meta]
 */
export const sendData = (res, data, status = 200, meta) =>
  res.status(status).json(meta === undefined ? { data } : { data, meta });

/** @param {string} s */
export const slugify = (s) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item';

/** @param {string} s */
export const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
