import { Router } from 'express';
import { z } from 'zod';
import type { NotificationDTO } from '@jky/shared';
import { Notification } from '../models/index.js';
import { asyncHandler, parse, sendData } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { oid } from '../services/access.js';

const q = z.object({
  unread: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export function notificationsRouter() {
  const r = Router();
  r.use('/notifications', requireAuth);
  r.get(
    '/notifications',
    asyncHandler(async (req, res) => {
      const query = parse(q, req.query);
      const filter: Record<string, unknown> = { recipientId: req.auth!.userId };
      if (query.unread === 'true') filter.readAt = null;
      const [items, unread] = await Promise.all([
        Notification.find(filter).sort({ createdAt: -1 }).limit(query.limit).lean(),
        Notification.countDocuments({ recipientId: req.auth!.userId, readAt: null }),
      ]);
      const data: NotificationDTO[] = items.map((n) => ({
        id: n._id.toString(),
        kind: n.kind,
        title: n.title,
        body: n.body ?? '',
        link: n.link ?? null,
        workspaceId: n.workspaceId?.toString() ?? null,
        readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
        createdAt: new Date(n.createdAt).toISOString(),
      }));
      sendData(res, data, 200, { unread });
    }),
  );
  r.patch(
    '/notifications/:nid/read',
    asyncHandler(async (req, res) => {
      const n = await Notification.findOneAndUpdate(
        { _id: oid(String(req.params.nid), 'Notification'), recipientId: req.auth!.userId },
        { $set: { readAt: new Date() } },
        { new: true },
      );
      if (!n) throw notFound('Notification');
      sendData(res, { id: n._id.toString(), readAt: n.readAt?.toISOString() });
    }),
  );
  r.post(
    '/notifications/read-all',
    asyncHandler(async (req, res) => {
      const out = await Notification.updateMany(
        { recipientId: req.auth!.userId, readAt: null },
        { $set: { readAt: new Date() } },
      );
      sendData(res, { updated: out.modifiedCount });
    }),
  );
  return r;
}
