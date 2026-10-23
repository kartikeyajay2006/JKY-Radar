import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function accessLog(req: Request, res: Response, next: NextFunction) {
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

export function notFoundHandler(req: Request, res: Response) {
  res
    .status(404)
    .json({
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${req.method} ${req.path}`,
        requestId: req.requestId,
      },
    });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let code = 'INTERNAL';
  let message = 'Something went wrong. Please try again.';
  let details: unknown;
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
    (err as { type: string }).type === 'entity.too.large'
  ) {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large.';
  } else if (
    typeof err === 'object' &&
    err &&
    'type' in err &&
    (err as { type: string }).type === 'entity.parse.failed'
  ) {
    status = 400;
    code = 'BAD_REQUEST';
    message = 'Malformed JSON body.';
  } else if (
    typeof err === 'object' &&
    err &&
    'code' in err &&
    (err as { code: unknown }).code === 'LIMIT_FILE_SIZE'
  ) {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Uploaded file is too large.';
  } else if (typeof err === 'object' && err && 'code' in err && (err as { code: unknown }).code === 11000) {
    status = 409;
    code = 'CONFLICT';
    message = 'A record with the same unique value already exists.';
  }
  if (status >= 500)
    logger.error('unhandled error', {
      requestId: req.requestId,
      err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
    });
  res
    .status(status)
    .json({
      error: { code, message, ...(details !== undefined ? { details } : {}), requestId: req.requestId },
    });
}
