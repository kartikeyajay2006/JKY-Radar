import { Membership, Notification } from '../models/index.js';
import { ROLE_RANK } from '@jky/shared';

/** @import { Types } from 'mongoose' */
/** @import { Role } from '@jky/shared' */

/**
 * @param {Types.ObjectId[]} userIds
 * @param {{ workspaceId?: Types.ObjectId; kind: string; title: string; body?: string; link?: string }} n
 */
export async function notifyUsers(userIds, n) {
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

/**
 * @param {Types.ObjectId} workspaceId
 * @param {Role} minRole
 * @param {Types.ObjectId | null} exclude
 * @param {{ kind: string; title: string; body?: string; link?: string }} n
 */
export async function notifyRole(workspaceId, minRole, exclude, n) {
  const members = await Membership.find({ workspaceId, status: 'active' }).lean();
  const ids = members
    .filter(
      (m) =>
        ROLE_RANK[/** @type {Role} */ (m.role)] >= ROLE_RANK[minRole] &&
        (!exclude || !m.userId.equals(exclude)),
    )
    .map((m) => m.userId);
  await notifyUsers(ids, { ...n, workspaceId });
}
