import type { Request } from 'express';
import type { Types } from 'mongoose';
import { AuditEvent } from '../models/index.js';
import { logger } from '../lib/logger.js';

const SENSITIVE = /pass|secret|token|content|cookie|authorization/i;

export async function audit(
  req: Request | null,
  e: {
    workspaceId?: Types.ObjectId | null;
    action: string;
    resourceType: string;
    resourceId?: string | Types.ObjectId | null;
    metadata?: Record<string, unknown>;
    actorId?: Types.ObjectId | null;
  },
): Promise<void> {
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
    logger.error('audit write failed', { action: e.action, err: (err as Error).message });
    throw err;
  }
}
