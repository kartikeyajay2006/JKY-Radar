import { AuditEvent } from '../models/index.js';
import { logger } from '../lib/logger.js';

/** @import { Request } from 'express' */
/** @import { Types } from 'mongoose' */
/** @import { AppRequest } from '../types.js' */

const SENSITIVE = /pass|secret|token|content|cookie|authorization/i;

/**
 * @param {AppRequest | null} req
 * @param {{ workspaceId?: Types.ObjectId | null; action: string; resourceType: string; resourceId?: string | Types.ObjectId | null; metadata?: Record<string, unknown>; actorId?: Types.ObjectId | null; }} e
 * @returns {Promise<void>}
 */
export async function audit(req, e) {
  const metadata = Object.fromEntries(
    Object.entries(e.metadata ?? {}).map(([k, v]) => [k, SENSITIVE.test(k) ? '[REDACTED]' : v]),
  );
  try {
    await AuditEvent.create({
      workspaceId: e.workspaceId ?? undefined,
      actorId: e.actorId ?? req?.auth?.userId,
      action: e.action,
      resourceType: e.resourceType,
      resourceId: e.resourceId ? String(e.resourceId) : undefined,
      metadata,
      requestId: req?.requestId,
    });
  } catch (err) {
    logger.error('audit write failed', { action: e.action, err: /** @type {Error} */ (err).message });
    throw err;
  }
}
