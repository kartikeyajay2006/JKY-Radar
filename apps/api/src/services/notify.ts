import type { Types } from 'mongoose';
import { Membership, Notification } from '../models/index.js';
import { ROLE_RANK, type Role } from '@jky/shared';

export async function notifyUsers(
  userIds: Types.ObjectId[],
  n: { workspaceId?: Types.ObjectId; kind: string; title: string; body?: string; link?: string },
) {
  if (userIds.length === 0) return;
  await Notification.insertMany(
    userIds.map((recipientId) => ({
      recipientId,
      workspaceId: n.workspaceId,
      kind: n.kind,
      title: n.title,
      body: n.body ?? '',
      link: n.link,
    })),
  );
}

export async function notifyRole(
  workspaceId: Types.ObjectId,
  minRole: Role,
  exclude: Types.ObjectId | null,
  n: { kind: string; title: string; body?: string; link?: string },
) {
  const members = await Membership.find({ workspaceId, status: 'active' }).lean();
  const ids = members
    .filter((m) => ROLE_RANK[m.role as Role] >= ROLE_RANK[minRole] && (!exclude || !m.userId.equals(exclude)))
    .map((m) => m.userId);
  await notifyUsers(ids, { ...n, workspaceId });
}
