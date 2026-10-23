/** @import { ErrorCode } from '@jky/shared' */

export class AppError extends Error {
  /**
   * @param {number} status
   * @param {ErrorCode | string} code
   * @param {string} message
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    /** @type {number} */
    this.status = status;
    /** @type {ErrorCode | string} */
    this.code = code;
    /** @type {unknown} */
    this.details = details;
    this.name = 'AppError';
  }
}

/**
 * @param {string} message
 * @param {unknown} [details]
 */
export const badRequest = (message, details) => new AppError(400, 'BAD_REQUEST', message, details);
/** @param {unknown} details */
export const validationFailed = (details, message = 'Request validation failed') =>
  new AppError(422, 'VALIDATION_FAILED', message, details);
export const unauthenticated = (message = 'Sign in to continue') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
/**
 * @param {string} message
 * @param {unknown} [details]
 */
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
/** @param {string} message */
export const quotaExceeded = (message) => new AppError(429, 'QUOTA_EXCEEDED', message);
