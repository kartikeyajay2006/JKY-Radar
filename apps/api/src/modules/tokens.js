import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { API_TOKEN_PREFIX, ciCheckSchema, createTokenSchema, roleAllows } from '@jky/shared';

import { Analysis, ApiToken, Membership, Project, SpecVersion } from '../models/index.js';
import { asyncHandler, parse, sendData } from '../lib/http.js';
import { AppError, badRequest, notFound, quotaExceeded } from '../lib/errors.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { loadProject, oid } from '../services/access.js';
import { audit } from '../services/audit.js';
import { createVersion } from '../services/versions.js';
import { requestAnalysis } from '../services/analyses.js';
import { userNames } from '../services/serialize.js';
import { requireAuth } from '../middleware/auth.js';

/** @import { NextFunction, RequestHandler, Response } from 'express' */
/** @import { ApiTokenDTO } from '@jky/shared' */
/** @import { Env } from '../config/env.js' */
/** @import { AppRequest } from '../types.js' */
/** @import { ApiTokenDoc } from '../models/index.js' */
/** @import { AnalysisRunner } from '../services/analysis-runner.js' */

const MAX_ACTIVE_TOKENS = 20;
const TOKEN_RE = new RegExp(`^Bearer\\s+(${API_TOKEN_PREFIX}[A-Za-z0-9_-]{32,64})$`);

/**
 * @param {ApiTokenDoc} t
 * @param {Map<string, string>} names
 * @returns {ApiTokenDTO}
 */
function tokenDTO(t, names) {
  const now = Date.now();
  const creator = t.createdBy?.toString();
  return {
    id: t._id.toString(),
    projectId: t.projectId.toString(),
    name: t.name,
    prefix: t.prefix,
    createdBy: creator ? { id: creator, name: names.get(creator) ?? 'Former member' } : null,
    createdAt: t.createdAt.toISOString(),
    expiresAt: t.expiresAt.toISOString(),
    lastUsedAt: t.lastUsedAt ? t.lastUsedAt.toISOString() : null,
    revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
    status: t.revokedAt ? 'revoked' : t.expiresAt.getTime() <= now ? 'expired' : 'active',
  };
}

/* ================================================================ management (signed-in users) */

/** Create, list and revoke a project's CI tokens. Admins only. */
export function tokensRouter() {
  const r = Router();
  r.use('/projects/:pid/tokens', requireAuth);

  r.get(
    '/projects/:pid/tokens',
    asyncHandler(async (req, res) => {
      const { project } = await loadProject(req, String(req.params.pid), 'token.manage');
      const tokens = /** @type {ApiTokenDoc[]} */ (
        await ApiToken.find({ projectId: project._id }).sort({ createdAt: -1 }).limit(100).lean()
      );
      const names = await userNames(tokens.map((t) => t.createdBy));
      sendData(
        res,
        tokens.map((t) => tokenDTO(t, names)),
      );
    }),
  );

  r.post(
    '/projects/:pid/tokens',
    asyncHandler(async (req, res) => {
      const { project, access } = await loadProject(req, String(req.params.pid), 'token.manage');
      const input = parse(createTokenSchema, req.body);
      const active = await ApiToken.countDocuments({
        projectId: project._id,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      });
      if (active >= MAX_ACTIVE_TOKENS)
        throw quotaExceeded(
          `A project can have at most ${MAX_ACTIVE_TOKENS} active tokens. Revoke one first.`,
        );
      const secret = `${API_TOKEN_PREFIX}${randomToken(32)}`;
      const token = await ApiToken.create({
        workspaceId: project.workspaceId,
        projectId: project._id,
        name: input.name,
        prefix: secret.slice(0, API_TOKEN_PREFIX.length + 6),
        tokenHash: sha256(secret),
        createdBy: access.userId,
        expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000),
      });
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'ci_credential.created',
        resourceType: 'project',
        resourceId: project._id,
        metadata: { name: token.name, prefix: token.prefix, expiresAt: token.expiresAt.toISOString() },
      });
      const names = await userNames([access.userId]);
      // The secret is returned exactly once; only its hash is stored.
      sendData(res, { token: tokenDTO(token.toObject(), names), secret }, 201);
    }),
  );

  r.delete(
    '/projects/:pid/tokens/:tid',
    asyncHandler(async (req, res) => {
      const { project, access } = await loadProject(req, String(req.params.pid), 'token.manage');
      const token = await ApiToken.findOne({
        _id: oid(String(req.params.tid), 'Token'),
        projectId: project._id,
      });
      if (!token) throw notFound('Token');
      if (!token.revokedAt) {
        token.revokedAt = new Date();
        token.revokedBy = access.userId;
        await token.save();
        await audit(req, {
          workspaceId: access.workspaceId,
          action: 'ci_credential.revoked',
          resourceType: 'project',
          resourceId: project._id,
          metadata: { name: token.name, prefix: token.prefix },
        });
      }
      const names = await userNames([token.createdBy]);
      sendData(res, tokenDTO(token.toObject(), names));
    }),
  );

  return r;
}

/* ================================================================ CI endpoint (bearer tokens) */

/**
 * @typedef {AppRequest & { ci?: { token: any; project: any } }} CiRequest
 */

const invalidToken = () =>
  new AppError(401, 'INVALID_TOKEN', 'The API token is missing, malformed, expired or revoked.');

/**
 * Authenticates `Authorization: Bearer jkyr_…`. A token acts with the permissions of the
 * person who created it, checked on every call, so removing that person (or lowering their
 * role) disables their tokens immediately. Cookies are ignored on these routes.
 * @param {CiRequest} req
 * @param {Response} _res
 * @param {NextFunction} next
 */
async function bearerAuth(req, _res, next) {
  try {
    const m = TOKEN_RE.exec(req.header('authorization') ?? '');
    if (!m) throw invalidToken();
    const token = await ApiToken.findOne({ tokenHash: sha256(m[1]) });
    if (!token || token.revokedAt || token.expiresAt.getTime() <= Date.now()) throw invalidToken();
    const project = await Project.findById(token.projectId);
    if (!project) throw invalidToken();
    const member = await Membership.findOne({
      workspaceId: project.workspaceId,
      userId: token.createdBy,
      status: 'active',
    }).lean();
    if (!member || !roleAllows(member.role, 'analysis.create') || !roleAllows(member.role, 'version.create'))
      throw new AppError(
        403,
        'TOKEN_OWNER_LACKS_ACCESS',
        'The person who created this token can no longer upload versions or run analyses in this project.',
      );
    if (Date.now() - (token.lastUsedAt?.getTime() ?? 0) > 60_000) {
      await ApiToken.updateOne({ _id: token._id }, { $set: { lastUsedAt: new Date() } });
    }
    req.ci = { token, project };
    next();
  } catch (e) {
    next(e);
  }
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PENDING = new Set(['queued', 'running']);

/**
 * @param {Env} env
 * @param {any} a analysis (lean)
 * @param {{ id: string; label: string }} baseline
 * @param {{ id: string; label: string; uploaded?: boolean }} candidate
 */
function verdict(env, a, baseline, candidate) {
  const id = a._id.toString();
  const web = env.WEB_ORIGIN.split(',')[0].trim().replace(/\/$/, '');
  return {
    analysisId: id,
    state: a.state,
    gate: a.gate ? { decision: a.gate.decision, reasons: a.gate.reasons ?? [] } : null,
    counts: a.counts ?? null,
    coverage: a.coverage?.level ?? null,
    error: a.state === 'failed' ? (a.error ?? null) : null,
    baseline,
    candidate,
    url: `${web}/app/analyses/${id}`,
    poll: `/api/v1/ci/analyses/${id}`,
  };
}

/**
 * Pipeline endpoints. Mounted before the cookie session and CSRF middleware: a bearer token
 * is never sent by a browser on its own, so these routes are not exposed to CSRF.
 * @param {Env} env
 * @param {AnalysisRunner} runner
 * @param {RequestHandler} limit
 */
export function ciRouter(env, runner, limit) {
  const r = Router();
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  r.use(/** @type {RequestHandler} */ (/** @type {unknown} */ (bearerAuth)));
  r.use(limit);

  r.post(
    '/check',
    asyncHandler(async (/** @type {CiRequest} */ req, res) => {
      const { token, project } = /** @type {NonNullable<CiRequest['ci']>} */ (req.ci);
      const input = parse(ciCheckSchema, req.body);
      const actorId = token.createdBy;
      const via = { via: 'ci', ciCredential: `${token.name} (${token.prefix}…)` };

      // Upload the candidate, or reuse the stored version when a pipeline re-runs on the same content.
      /** @type {any} */
      let cv;
      let uploaded = false;
      try {
        cv = await createVersion(
          project,
          actorId,
          /** @type {import('../services/versions.js').NewVersionInput} */ ({
            ...input.candidate,
            notes: input.candidate.notes ?? `Uploaded from CI (${token.name})`,
          }),
          env.MAX_SPEC_BYTES,
        );
        uploaded = true;
        await audit(req, {
          workspaceId: project.workspaceId,
          actorId,
          action: 'version.uploaded',
          resourceType: 'version',
          resourceId: cv._id,
          metadata: {
            projectId: project._id.toString(),
            label: cv.label,
            protocol: cv.protocol,
            rawHash: cv.rawHash,
            redactions: cv.redactions.length,
            ...via,
          },
        });
      } catch (e) {
        const existingId = /** @type {any} */ (e)?.details?.existingVersionId;
        if (!(e instanceof AppError && e.status === 409 && existingId)) throw e;
        cv = await SpecVersion.findById(existingId);
      }

      /** @type {any} */
      let bv;
      if (input.baseline) {
        bv = await SpecVersion.findOne({
          projectId: project._id,
          ...(isValidObjectId(input.baseline) && /^[a-f0-9]{24}$/i.test(input.baseline)
            ? { _id: input.baseline }
            : { label: input.baseline }),
        }).sort({ createdAt: -1 });
        if (!bv) throw notFound(`Baseline "${input.baseline}" in this project`);
      } else {
        bv = await SpecVersion.findOne({
          projectId: project._id,
          _id: { $ne: cv._id },
          createdAt: { $lte: cv.createdAt },
        }).sort({ createdAt: -1 });
        if (!bv)
          throw new AppError(
            422,
            'NO_BASELINE',
            'This project has no earlier version to compare with. Upload a baseline first, or pass "baseline".',
          );
      }
      if (bv._id.equals(cv._id)) throw badRequest('The candidate is identical to the baseline.');

      const { analysis, cached } = await requestAnalysis(req, runner, {
        project,
        baseline: bv,
        candidate: cv,
        options: input.options,
        actorId,
        auditMetadata: via,
      });
      const id = analysis._id.toString();
      let current = analysis.toObject();
      if (PENDING.has(current.state) && input.wait > 0) {
        const done = runner.waitFor(id);
        current = (await Analysis.findById(id).lean()) ?? current;
        if (PENDING.has(current.state)) {
          await Promise.race([done, sleep(input.wait * 1000)]);
          current = (await Analysis.findById(id).lean()) ?? current;
        }
      }
      sendData(
        res,
        {
          ...verdict(
            env,
            current,
            { id: bv._id.toString(), label: bv.label },
            { id: cv._id.toString(), label: cv.label, uploaded },
          ),
          cached,
        },
        PENDING.has(current.state) ? 202 : 200,
      );
    }),
  );

  r.get(
    '/analyses/:aid',
    asyncHandler(async (/** @type {CiRequest} */ req, res) => {
      const { project } = /** @type {NonNullable<CiRequest['ci']>} */ (req.ci);
      const a = await Analysis.findOne({
        _id: oid(String(req.params.aid), 'Analysis'),
        projectId: project._id,
      }).lean();
      if (!a) throw notFound('Analysis');
      const [bv, cv] = await Promise.all([
        SpecVersion.findById(a.baselineId).select('label').lean(),
        SpecVersion.findById(a.candidateId).select('label').lean(),
      ]);
      sendData(
        res,
        verdict(
          env,
          a,
          { id: a.baselineId.toString(), label: bv?.label ?? '' },
          { id: a.candidateId.toString(), label: cv?.label ?? '' },
        ),
        PENDING.has(a.state) ? 202 : 200,
      );
    }),
  );

  return r;
}
