/** @import { NextFunction, Request, Response } from 'express' */

import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
/** @import { AppRequest } from '../types.js' */

/**
 * @param {AppRequest} req
 * @param {Response} res
 * @param {NextFunction} next
 */
export function requestId(req, res, next) {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/**
 * @param {AppRequest} req
 * @param {Response} res
 * @param {NextFunction} next
 */
export function accessLog(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Math.round(ms),
      user: req.auth?.userId?.toString(),
    });
  });
  next();
}

/**
 * @param {AppRequest} req
 * @param {Response} res
 */
export function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.path}`,
      requestId: req.requestId,
    },
  });
}

/**
 * @param {unknown} err
 * @param {AppRequest} req
 * @param {Response} res
 * @param {NextFunction} _next
 */
export function errorHandler(err, req, res, _next) {
  let status = 500;
  let code = 'INTERNAL';
  let message = 'Something went wrong. Please try again.';
  /** @type {unknown} */
  let details;
  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_FAILED';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 404;
    code = 'NOT_FOUND';
    message = 'Resource not found';
  } else if (
    typeof err === 'object' &&
    err &&
    'type' in err &&
    /** @type {{ type: string }} */ (err).type === 'entity.too.large'
  ) {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  } else if (
    typeof err === 'object' &&
    err &&
    'type' in err &&
    /** @type {{ type: string }} */ (err).type === 'entity.parse.failed'
  ) {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Malformed JSON body.';
  } else if (
    typeof err === 'object' &&
    err &&
    'code' in err &&
    /** @type {{ code: unknown }} */ (err).code === 'LIMIT_FILE_SIZE'
  ) {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Uploaded file is too large.';
  } else if (
    typeof err === 'object' &&
    err &&
    'code' in err &&
    /** @type {{ code: unknown }} */ (err).code === 11000
  ) {
    status = 409;
    code = 'CONFLICT';
    message = 'A record with the same unique value already exists.';
  }
  if (status >= 500)
    logger.error('unhandled error', {
      requestId: req.requestId,
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    });
  res.status(status).json({
    error: { code, message, ...(details !== undefined ? { details } : {}), requestId: req.requestId },
  });
}
