/** @import { Request } from 'express' */
/** @import { Permission, Role } from '@jky/shared' */

import { isValidObjectId, Types } from 'mongoose';
import { ROLE_RANK, roleAllows } from '@jky/shared';
import { Analysis, Consumer, Membership, Project, SpecVersion, Workspace } from '../models/index.js';
import { forbidden, notFound, unauthenticated } from '../lib/errors.js';
/** @import { AppRequest } from '../types.js' */

/**
 * @typedef {Object} AccessContext
 * @property {Types.ObjectId} userId
 * @property {Types.ObjectId} workspaceId
 * @property {Role} role
 */

/**
 * @param {AppRequest} req
 * @returns {Types.ObjectId}
 */
function uid(req) {
  if (!req.auth) throw unauthenticated();
  return req.auth.userId;
}

/**
 * @param {string} id
 * @param {string} what
 */
const oid = (id, what) => {
  if (!isValidObjectId(id) || !/^[a-f0-9]{24}$/i.test(id)) throw notFound(what);
  return new Types.ObjectId(id);
};

/**
 * Authorisation is always derived from the stored resource chain and the caller's
 * actual membership — never from workspace ids supplied by the client.
 * Non-members get 404 (no existence leak); members lacking the role get 403.
 * @param {AppRequest} req
 * @param {Types.ObjectId | string} workspaceId
 * @param {Permission} permission
 * @returns {Promise<AccessContext>}
 */
export async function workspaceAccess(req, workspaceId, permission) {
  const userId = uid(req);
  const wid = typeof workspaceId === 'string' ? oid(workspaceId, 'Workspace') : workspaceId;
  const m = await Membership.findOne({ workspaceId: wid, userId, status: 'active' }).lean();
  if (!m) throw notFound('Workspace');
  const role = /** @type {Role} */ (m.role);
  if (!roleAllows(role, permission)) throw forbidden(`Your role (${role}) cannot perform this action.`);
  return { userId, workspaceId: wid, role };
}

/**
 * @param {AppRequest} req
 * @param {string} id
 * @param {Permission} [permission]
 */
export async function loadWorkspace(req, id, permission = 'workspace.read') {
  const access = await workspaceAccess(req, id, permission);
  const workspace = await Workspace.findById(access.workspaceId);
  if (!workspace) throw notFound('Workspace');
  return { workspace, access };
}

/**
 * @param {AppRequest} req
 * @param {string} id
 * @param {Permission} [permission]
 */
export async function loadProject(req, id, permission = 'workspace.read') {
  const project = await Project.findById(oid(id, 'Project'));
  if (!project) throw notFound('Project');
  const access = await workspaceAccess(req, project.workspaceId, permission);
  return { project, access };
}

/**
 * @param {AppRequest} req
 * @param {string} id
 * @param {Permission} [permission]
 */
export async function loadVersion(req, id, permission = 'workspace.read') {
  const version = await SpecVersion.findById(oid(id, 'Version'));
  if (!version) throw notFound('Version');
  const access = await workspaceAccess(req, version.workspaceId, permission);
  return { version, access };
}

/**
 * @param {AppRequest} req
 * @param {string} id
 * @param {Permission} [permission]
 */
export async function loadAnalysis(req, id, permission = 'workspace.read') {
  const analysis = await Analysis.findById(oid(id, 'Analysis'));
  if (!analysis) throw notFound('Analysis');
  const access = await workspaceAccess(req, analysis.workspaceId, permission);
  return { analysis, access };
}

/**
 * @param {AppRequest} req
 * @param {string} id
 * @param {Permission} [permission]
 */
export async function loadConsumer(req, id, permission = 'consumer.manage') {
  const consumer = await Consumer.findById(oid(id, 'Consumer'));
  if (!consumer) throw notFound('Consumer');
  const access = await workspaceAccess(req, consumer.workspaceId, permission);
  return { consumer, access };
}

/**
 * @param {Role} role
 * @param {Role} min
 */
export const atLeast = (role, min) => ROLE_RANK[role] >= ROLE_RANK[min];
export { oid };
