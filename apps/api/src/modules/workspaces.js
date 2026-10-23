/** @import { Types } from 'mongoose' */
/** @import { AuditEventDTO, InvitationDTO, MemberDTO, OverviewDTO, Role, WorkspaceDTO } from '@jky/shared' */
/** @import { FindingSeverity } from '@jky/radar-core' */
import { Router } from 'express';

import {
  createProjectSchema,
  createWorkspaceSchema,
  inviteSchema,
  LIMITS,
  listProjectsQuery,
  paginationQuery,
  updateMemberSchema,
  updateWorkspaceSchema,
} from '@jky/shared';
import { SEVERITY_RANK, emptyCounts } from '@jky/radar-core';
import {
  Analysis,
  AuditEvent,
  Consumer,
  FindingModel,
  Membership,
  Project,
  SpecVersion,
  User,
  Workspace,
} from '../models/index.js';
import { asyncHandler, escapeRegex, parse, sendData, slugify } from '../lib/http.js';
import { AppError, badRequest, conflict, forbidden, notFound, quotaExceeded } from '../lib/errors.js';
import { randomToken } from '../lib/crypto.js';
import { requireAuth } from '../middleware/auth.js';
import { loadWorkspace, oid, workspaceAccess } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notifyUsers } from '../services/notify.js';
import { ensurePolicy } from '../services/policies.js';
import { analysisSummaryDTO, projectDTO, userNames } from '../services/serialize.js';
import { loadImpact } from '../services/reports.js';

/**
 * @param {string} base
 * @param {(slug: string) => Promise<unknown>} exists
 */
async function uniqueSlug(base, exists) {
  let slug = slugify(base);
  for (let i = 0; i < 5 && (await exists(slug)); i++)
    slug = `${slugify(base)}-${randomToken(3)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')}`;
  return slug;
}

/**
 * @param {Types.ObjectId} workspaceId
 * @param {string} [search]
 */
export async function projectList(workspaceId, search) {
  /** @type {Record<string, unknown>} */
  const filter = { workspaceId };
  if (search) filter.name = { $regex: escapeRegex(search), $options: 'i' };
  const projects = await Project.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
  const [versions, analyses] = await Promise.all([
    SpecVersion.find({ _id: { $in: projects.map((p) => p.latestVersionId).filter(Boolean) } })
      .select('label createdAt')
      .lean(),
    Analysis.find({ _id: { $in: projects.map((p) => p.latestAnalysisId).filter(Boolean) } })
      .select('gate state createdAt')
      .lean(),
  ]);
  const vm = new Map(versions.map((v) => [v._id.toString(), v]));
  const am = new Map(analyses.map((a) => [a._id.toString(), a]));
  return projects.map((p) =>
    projectDTO(
      p,
      vm.get(p.latestVersionId?.toString() ?? '') ?? null,
      am.get(p.latestAnalysisId?.toString() ?? '') ?? null,
    ),
  );
}

export function workspacesRouter() {
  const r = Router();
  r.use(['/workspaces', '/invitations'], requireAuth);

  r.get(
    '/workspaces',
    asyncHandler(async (req, res) => {
      const memberships = await Membership.find({ userId: req.auth.userId, status: 'active' }).lean();
      const workspaces = await Workspace.find({ _id: { $in: memberships.map((m) => m.workspaceId) } }).lean();
      const [projectCounts, memberCounts] = await Promise.all([
        /** @type {Promise<Array<{ _id: Types.ObjectId; n: number }>>} */ (
          Project.aggregate([
            { $match: { workspaceId: { $in: workspaces.map((w) => w._id) } } },
            { $group: { _id: '$workspaceId', n: { $sum: 1 } } },
          ])
        ),
        /** @type {Promise<Array<{ _id: Types.ObjectId; n: number }>>} */ (
          Membership.aggregate([
            { $match: { workspaceId: { $in: workspaces.map((w) => w._id) }, status: 'active' } },
            { $group: { _id: '$workspaceId', n: { $sum: 1 } } },
          ])
        ),
      ]);
      const pc = new Map(projectCounts.map((x) => [x._id.toString(), x.n]));
      const mc = new Map(memberCounts.map((x) => [x._id.toString(), x.n]));
      /** @type {WorkspaceDTO[]} */
      const data = workspaces
        .map((w) => ({
          id: w._id.toString(),
          name: w.name,
          slug: w.slug,
          role: /** @type {Role} */ (memberships.find((m) => m.workspaceId.equals(w._id)).role),
          isDemo: !!w.isDemo,
          createdAt: new Date(w.createdAt).toISOString(),
          counts: { projects: pc.get(w._id.toString()) ?? 0, members: mc.get(w._id.toString()) ?? 0 },
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      sendData(res, data);
    }),
  );

  r.post(
    '/workspaces',
    asyncHandler(async (req, res) => {
      const input = parse(createWorkspaceSchema, req.body);
      const owned = await Membership.countDocuments({ userId: req.auth.userId, role: 'OWNER' });
      if (owned >= LIMITS.maxWorkspacesPerUser)
        throw quotaExceeded(`You can own at most ${LIMITS.maxWorkspacesPerUser} workspaces.`);
      const slug = await uniqueSlug(input.name, (s) => Workspace.exists({ slug: s }));
      const w = await Workspace.create({ name: input.name, slug, ownerId: req.auth.userId });
      await Membership.create({ workspaceId: w._id, userId: req.auth.userId, role: 'OWNER' });
      await audit(req, {
        workspaceId: w._id,
        action: 'workspace.created',
        resourceType: 'workspace',
        resourceId: w._id,
        metadata: { name: w.name },
      });
      sendData(
        res,
        /** @satisfies {WorkspaceDTO} */ ({
          id: w._id.toString(),
          name: w.name,
          slug: w.slug,
          role: 'OWNER',
          isDemo: false,
          createdAt: w.createdAt.toISOString(),
        }),
        201,
      );
    }),
  );

  r.get(
    '/workspaces/:wid',
    asyncHandler(async (req, res) => {
      const { workspace, access } = await loadWorkspace(req, String(req.params.wid));
      sendData(
        res,
        /** @satisfies {WorkspaceDTO} */ ({
          id: workspace._id.toString(),
          name: workspace.name,
          slug: workspace.slug,
          role: access.role,
          isDemo: !!workspace.isDemo,
          createdAt: workspace.createdAt.toISOString(),
        }),
      );
    }),
  );

  r.patch(
    '/workspaces/:wid',
    asyncHandler(async (req, res) => {
      const { workspace, access } = await loadWorkspace(req, String(req.params.wid), 'workspace.update');
      const input = parse(updateWorkspaceSchema, req.body);
      const before = workspace.name;
      workspace.name = input.name;
      await workspace.save();
      await audit(req, {
        workspaceId: workspace._id,
        action: 'workspace.renamed',
        resourceType: 'workspace',
        resourceId: workspace._id,
        metadata: { before, after: input.name },
      });
      sendData(
        res,
        /** @satisfies {WorkspaceDTO} */ ({
          id: workspace._id.toString(),
          name: workspace.name,
          slug: workspace.slug,
          role: access.role,
          isDemo: !!workspace.isDemo,
          createdAt: workspace.createdAt.toISOString(),
        }),
      );
    }),
  );

  /* ------------------------------------------------------------ members */
  r.get(
    '/workspaces/:wid/members',
    asyncHandler(async (req, res) => {
      const { access } = await loadWorkspace(req, String(req.params.wid));
      const ms = await Membership.find({ workspaceId: access.workspaceId }).sort({ createdAt: 1 }).lean();
      const users = await User.find({ _id: { $in: ms.map((m) => m.userId) } })
        .select('email name')
        .lean();
      const um = new Map(users.map((u) => [u._id.toString(), u]));
      /** @type {MemberDTO[]} */
      const data = ms.map((m) => ({
        id: m._id.toString(),
        userId: m.userId.toString(),
        email: um.get(m.userId.toString())?.email ?? '',
        name: um.get(m.userId.toString())?.name ?? 'Unknown',
        role: /** @type {Role} */ (m.role),
        status: /** @type {'active' | 'invited'} */ (m.status),
        createdAt: new Date(m.createdAt).toISOString(),
      }));
      sendData(res, data);
    }),
  );

  r.post(
    '/workspaces/:wid/invitations',
    asyncHandler(async (req, res) => {
      const { workspace, access } = await loadWorkspace(req, String(req.params.wid), 'members.manage');
      const input = parse(inviteSchema, req.body);
      const user = await User.findOne({ email: input.email, isSystem: { $ne: true } });
      if (!user)
        throw new AppError(
          404,
          'NOT_FOUND',
          'No JKY-Radar account uses this email yet. Ask them to register, then invite again.',
        );
      if (await Membership.exists({ workspaceId: access.workspaceId, userId: user._id }))
        throw conflict('This person is already a member or has a pending invitation.');
      const m = await Membership.create({
        workspaceId: access.workspaceId,
        userId: user._id,
        role: input.role,
        status: 'invited',
        invitedBy: access.userId,
      });
      await notifyUsers([user._id], {
        workspaceId: access.workspaceId,
        kind: 'workspace.invited',
        title: `You were invited to ${workspace.name}`,
        body: `Role: ${input.role}`,
        link: '/app/settings?tab=invitations',
      });
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'member.invited',
        resourceType: 'membership',
        resourceId: m._id,
        metadata: { email: input.email, role: input.role },
      });
      sendData(res, { id: m._id.toString(), status: 'invited' }, 201);
    }),
  );

  r.patch(
    '/workspaces/:wid/members/:mid',
    asyncHandler(async (req, res) => {
      const { access } = await loadWorkspace(req, String(req.params.wid), 'members.manage');
      const input = parse(updateMemberSchema, req.body);
      const m = await Membership.findOne({
        _id: oid(String(req.params.mid), 'Member'),
        workspaceId: access.workspaceId,
      });
      if (!m) throw notFound('Member');
      if (m.role === 'OWNER') throw forbidden('The owner role cannot be changed here.');
      if (m.userId.equals(access.userId)) throw forbidden('You cannot change your own role.');
      if (access.role === 'ADMIN' && m.role === 'ADMIN')
        throw forbidden('Only the owner can change another admin.');
      const before = m.role;
      m.role = input.role;
      await m.save();
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'member.role_changed',
        resourceType: 'membership',
        resourceId: m._id,
        metadata: { userId: m.userId.toString(), before, after: input.role },
      });
      sendData(res, { id: m._id.toString(), role: m.role });
    }),
  );

  r.delete(
    '/workspaces/:wid/members/:mid',
    asyncHandler(async (req, res) => {
      const access = await workspaceAccess(req, String(req.params.wid), 'workspace.read');
      const m = await Membership.findOne({
        _id: oid(String(req.params.mid), 'Member'),
        workspaceId: access.workspaceId,
      });
      if (!m) throw notFound('Member');
      const self = m.userId.equals(access.userId);
      if (m.role === 'OWNER') throw forbidden('The owner cannot be removed.');
      if (!self && !['OWNER', 'ADMIN'].includes(access.role)) throw forbidden();
      await m.deleteOne();
      await audit(req, {
        workspaceId: access.workspaceId,
        action: self ? 'member.left' : 'member.removed',
        resourceType: 'membership',
        resourceId: m._id,
        metadata: { userId: m.userId.toString(), role: m.role },
      });
      res.status(204).end();
    }),
  );

  r.get(
    '/invitations',
    asyncHandler(async (req, res) => {
      const ms = await Membership.find({ userId: req.auth.userId, status: 'invited' }).lean();
      const ws = await Workspace.find({ _id: { $in: ms.map((m) => m.workspaceId) } })
        .select('name')
        .lean();
      const names = await userNames(ms.map((m) => m.invitedBy));
      /** @type {InvitationDTO[]} */
      const data = ms.map((m) => ({
        id: m._id.toString(),
        workspaceId: m.workspaceId.toString(),
        workspaceName: ws.find((w) => w._id.equals(m.workspaceId))?.name ?? 'Workspace',
        role: /** @type {Role} */ (m.role),
        invitedBy: names.get(m.invitedBy?.toString() ?? '') ?? 'Unknown',
        createdAt: new Date(m.createdAt).toISOString(),
      }));
      sendData(res, data);
    }),
  );

  r.post(
    '/invitations/:mid/:action',
    asyncHandler(async (req, res) => {
      const action = String(req.params.action);
      if (action !== 'accept' && action !== 'decline') throw badRequest('Unknown invitation action');
      const m = await Membership.findOne({
        _id: oid(String(req.params.mid), 'Invitation'),
        userId: req.auth.userId,
        status: 'invited',
      });
      if (!m) throw notFound('Invitation');
      if (action === 'accept') {
        m.status = 'active';
        await m.save();
      } else await m.deleteOne();
      await audit(req, {
        workspaceId: m.workspaceId,
        action: `member.invitation_${action}ed`,
        resourceType: 'membership',
        resourceId: m._id,
        metadata: { role: m.role },
      });
      sendData(res, { id: m._id.toString(), status: action === 'accept' ? 'active' : 'declined' });
    }),
  );

  /* ------------------------------------------------------------ projects */
  r.get(
    '/workspaces/:wid/projects',
    asyncHandler(async (req, res) => {
      const access = await workspaceAccess(req, String(req.params.wid), 'workspace.read');
      const q = parse(listProjectsQuery, req.query);
      sendData(res, await projectList(access.workspaceId, q.search));
    }),
  );

  r.post(
    '/workspaces/:wid/projects',
    asyncHandler(async (req, res) => {
      const access = await workspaceAccess(req, String(req.params.wid), 'project.create');
      const input = parse(createProjectSchema, req.body);
      if (
        (await Project.countDocuments({ workspaceId: access.workspaceId })) >= LIMITS.maxProjectsPerWorkspace
      ) {
        throw quotaExceeded(`A workspace can hold at most ${LIMITS.maxProjectsPerWorkspace} projects.`);
      }
      const slug = await uniqueSlug(input.name, (s) =>
        Project.exists({ workspaceId: access.workspaceId, slug: s }),
      );
      const p = await Project.create({
        workspaceId: access.workspaceId,
        name: input.name,
        slug,
        description: input.description,
        protocol: input.protocol,
        createdBy: access.userId,
      });
      await ensurePolicy(access.workspaceId, p._id, access.userId);
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'project.created',
        resourceType: 'project',
        resourceId: p._id,
        metadata: { name: p.name, protocol: p.protocol },
      });
      sendData(res, projectDTO(p.toObject(), null, null), 201);
    }),
  );

  /* ------------------------------------------------------------ analytics */
  r.get(
    '/workspaces/:wid/overview',
    asyncHandler(async (req, res) => {
      const access = await workspaceAccess(req, String(req.params.wid), 'workspace.read');
      const wid = access.workspaceId;
      const since = new Date(Date.now() - 13 * 86400_000);
      since.setUTCHours(0, 0, 0, 0);
      const [projects, versions, analysesCount, consumers, completed, timelineRaw, topEntitiesRaw, recent] =
        await Promise.all([
          Project.countDocuments({ workspaceId: wid }),
          SpecVersion.countDocuments({ workspaceId: wid }),
          Analysis.countDocuments({ workspaceId: wid }),
          Consumer.countDocuments({ workspaceId: wid }),
          Analysis.find({ workspaceId: wid, state: 'completed' })
            .select('gate counts reviewStatus projectId createdAt')
            .lean(),
          /** @type {Promise<Array<{ _id: string; analyses: number; blocked: number }>>} */ (
            Analysis.aggregate([
              { $match: { workspaceId: wid, createdAt: { $gte: since } } },
              {
                $group: {
                  _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                  analyses: { $sum: 1 },
                  blocked: { $sum: { $cond: [{ $eq: ['$gate.decision', 'block'] }, 1, 0] } },
                },
              },
            ])
          ),
          /** @type {Promise<Array<{ _id: string; count: number; severities: string[] }>>} */ (
            FindingModel.aggregate([
              {
                $match: {
                  workspaceId: wid,
                  severity: { $in: ['breaking', 'potentially_breaking', 'needs_review'] },
                  entityKey: { $exists: true, $ne: null },
                },
              },
              { $group: { _id: '$entityKey', count: { $sum: 1 }, severities: { $addToSet: '$severity' } } },
              { $sort: { count: -1, _id: 1 } },
              { $limit: 8 },
            ])
          ),
          Analysis.find({ workspaceId: wid }).sort({ createdAt: -1 }).limit(8).lean(),
        ]);
      const severityTotals = emptyCounts();
      const gateTotals = { pass: 0, warn: 0, block: 0, inconclusive: 0 };
      let reviewed = 0;
      let reviewTotal = 0;
      for (const a of completed) {
        for (const s of /** @type {FindingSeverity[]} */ (Object.keys(severityTotals)))
          severityTotals[s] += a.counts?.[s] ?? 0;
        const g = /** @type {keyof typeof gateTotals | undefined} */ (a.gate?.decision);
        if (g) gateTotals[g]++;
        if (a.reviewStatus !== 'not_required') {
          reviewTotal++;
          if (a.reviewStatus !== 'pending') reviewed++;
        }
      }
      /** @type {OverviewDTO['timeline']} */
      const timeline = [];
      for (let i = 0; i < 14; i++) {
        const d = new Date(since.getTime() + i * 86400_000).toISOString().slice(0, 10);
        const hit = timelineRaw.find((t) => t._id === d);
        timeline.push({ date: d, analyses: hit?.analyses ?? 0, blocked: hit?.blocked ?? 0 });
      }
      // Consumers most affected, computed from each project's latest completed analysis.
      const latestByProject = /** @type {Map<string, (typeof completed)[number]>} */ (new Map());
      for (const a of [...completed].sort((x, y) => +new Date(y.createdAt) - +new Date(x.createdAt))) {
        if (!latestByProject.has(a.projectId.toString())) latestByProject.set(a.projectId.toString(), a);
      }
      const consumerHits = /** @type {Map<string, { name: string; criticality: string; n: number }>} */ (
        new Map()
      );
      for (const a of latestByProject.values()) {
        const impact = await loadImpact(a);
        for (const c of impact.consumers) {
          if (!c.known.length && !c.potential.length) continue;
          const cur = consumerHits.get(c.consumerId) ?? { name: c.name, criticality: c.criticality, n: 0 };
          cur.n++;
          consumerHits.set(c.consumerId, cur);
        }
      }
      const labels = await SpecVersion.find({
        _id: { $in: recent.flatMap((a) => [a.baselineId, a.candidateId]) },
      })
        .select('label')
        .lean();
      const lm = new Map(labels.map((v) => [v._id.toString(), v.label]));
      const names = await userNames(recent.map((a) => a.createdBy));
      const pnames = new Map(
        (
          await Project.find({ _id: { $in: recent.map((a) => a.projectId) } })
            .select('name')
            .lean()
        ).map((p) => [p._id.toString(), p.name]),
      );
      /** @type {OverviewDTO} */
      const data = {
        counts: {
          projects,
          versions,
          analyses: analysesCount,
          consumers,
          blocked: gateTotals.block,
          pendingReviews: completed.filter((a) => a.reviewStatus === 'pending' && a.gate?.decision !== 'pass')
            .length,
        },
        severityTotals,
        gateTotals,
        timeline,
        topEntities: topEntitiesRaw.map((t) => ({
          entityKey: t._id,
          count: t.count,
          worst: /** @type {FindingSeverity[]} */ (t.severities).sort(
            (a, b) => SEVERITY_RANK[a] - SEVERITY_RANK[b],
          )[0],
        })),
        topConsumers: [...consumerHits.entries()]
          .map(([consumerId, v]) => ({
            consumerId,
            name: v.name,
            criticality: v.criticality,
            impactedAnalyses: v.n,
          }))
          .sort((a, b) => b.impactedAnalyses - a.impactedAnalyses)
          .slice(0, 6),
        reviewCompletion: { reviewed, total: reviewTotal },
        recentAnalyses: recent.map((a) =>
          analysisSummaryDTO(a, lm, names, pnames.get(a.projectId.toString())),
        ),
      };
      sendData(res, data);
    }),
  );

  r.get(
    '/workspaces/:wid/analyses',
    asyncHandler(async (req, res) => {
      const access = await workspaceAccess(req, String(req.params.wid), 'workspace.read');
      const q = parse(paginationQuery, req.query);
      const [items, total] = await Promise.all([
        Analysis.find({ workspaceId: access.workspaceId })
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize)
          .lean(),
        Analysis.countDocuments({ workspaceId: access.workspaceId }),
      ]);
      const labels = await SpecVersion.find({
        _id: { $in: items.flatMap((a) => [a.baselineId, a.candidateId]) },
      })
        .select('label')
        .lean();
      const lm = new Map(labels.map((v) => [v._id.toString(), v.label]));
      const names = await userNames(items.map((a) => a.createdBy));
      const pnames = new Map(
        (
          await Project.find({ _id: { $in: items.map((a) => a.projectId) } })
            .select('name')
            .lean()
        ).map((p) => [p._id.toString(), p.name]),
      );
      sendData(
        res,
        items.map((a) => analysisSummaryDTO(a, lm, names, pnames.get(a.projectId.toString()))),
        200,
        { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
      );
    }),
  );

  r.get(
    '/workspaces/:wid/audit',
    asyncHandler(async (req, res) => {
      const access = await workspaceAccess(req, String(req.params.wid), 'audit.read');
      const q = parse(paginationQuery, req.query);
      const [items, total] = await Promise.all([
        AuditEvent.find({ workspaceId: access.workspaceId })
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize)
          .lean(),
        AuditEvent.countDocuments({ workspaceId: access.workspaceId }),
      ]);
      const names = await userNames(items.map((e) => e.actorId));
      /** @type {AuditEventDTO[]} */
      const data = items.map((e) => ({
        id: e._id.toString(),
        actor: e.actorId
          ? { id: e.actorId.toString(), name: names.get(e.actorId.toString()) ?? 'Unknown' }
          : null,
        action: e.action,
        resourceType: e.resourceType,
        resourceId: e.resourceId ?? null,
        metadata: e.metadata ?? {},
        ...(e.requestId ? { requestId: e.requestId } : {}),
        createdAt: new Date(e.createdAt).toISOString(),
      }));
      sendData(res, data, 200, {
        page: q.page,
        pageSize: q.pageSize,
        total,
        totalPages: Math.ceil(total / q.pageSize),
      });
    }),
  );

  return r;
}
