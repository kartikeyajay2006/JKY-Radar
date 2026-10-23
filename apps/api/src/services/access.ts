import type { Request } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { ROLE_RANK, roleAllows, type Permission, type Role } from '@jky/shared';
import { Analysis, Consumer, Membership, Project, SpecVersion, Workspace } from '../models/index.js';
import { forbidden, notFound, unauthenticated } from '../lib/errors.js';

export interface AccessContext {
  userId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  role: Role;
}

function uid(req: Request): Types.ObjectId {
  if (!req.auth) throw unauthenticated();
  return req.auth.userId;
}

const oid = (id: string, what: string) => {
  if (!isValidObjectId(id) || !/^[a-f0-9]{24}$/i.test(id)) throw notFound(what);
  return new Types.ObjectId(id);
};

/**
 * Authorisation is always derived from the stored resource chain and the caller's
 * actual membership — never from workspace ids supplied by the client.
 * Non-members get 404 (no existence leak); members lacking the role get 403.
 */
export async function workspaceAccess(
  req: Request,
  workspaceId: Types.ObjectId | string,
  permission: Permission,
): Promise<AccessContext> {
  const userId = uid(req);
  const wid = typeof workspaceId === 'string' ? oid(workspaceId, 'Workspace') : workspaceId;
  const m = await Membership.findOne({ workspaceId: wid, userId, status: 'active' }).lean();
  if (!m) throw notFound('Workspace');
  const role = m.role as Role;
  if (!roleAllows(role, permission)) throw forbidden(`Your role (${role}) cannot perform this action.`);
  return { userId, workspaceId: wid, role };
}

export async function loadWorkspace(req: Request, id: string, permission: Permission = 'workspace.read') {
  const access = await workspaceAccess(req, id, permission);
  const workspace = await Workspace.findById(access.workspaceId);
  if (!workspace) throw notFound('Workspace');
  return { workspace, access };
}

export async function loadProject(req: Request, id: string, permission: Permission = 'workspace.read') {
  const project = await Project.findById(oid(id, 'Project'));
  if (!project) throw notFound('Project');
  const access = await workspaceAccess(req, project.workspaceId, permission);
  return { project, access };
}

export async function loadVersion(req: Request, id: string, permission: Permission = 'workspace.read') {
  const version = await SpecVersion.findById(oid(id, 'Version'));
  if (!version) throw notFound('Version');
  const access = await workspaceAccess(req, version.workspaceId, permission);
  return { version, access };
}

export async function loadAnalysis(req: Request, id: string, permission: Permission = 'workspace.read') {
  const analysis = await Analysis.findById(oid(id, 'Analysis'));
  if (!analysis) throw notFound('Analysis');
  const access = await workspaceAccess(req, analysis.workspaceId, permission);
  return { analysis, access };
}

export async function loadConsumer(req: Request, id: string, permission: Permission = 'consumer.manage') {
  const consumer = await Consumer.findById(oid(id, 'Consumer'));
  if (!consumer) throw notFound('Consumer');
  const access = await workspaceAccess(req, consumer.workspaceId, permission);
  return { consumer, access };
}

export const atLeast = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];
export { oid };
