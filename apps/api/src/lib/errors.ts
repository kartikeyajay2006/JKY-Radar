import type { ErrorCode } from '@jky/shared';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', message, details);
export const validationFailed = (details: unknown, message = 'Request validation failed') =>
  new AppError(422, 'VALIDATION_FAILED', message, details);
export const unauthenticated = (message = 'Sign in to continue') =>
  new AppError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to do this') =>
  new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', message, details);
export const quotaExceeded = (message: string) => new AppError(429, 'QUOTA_EXCEEDED', message);
