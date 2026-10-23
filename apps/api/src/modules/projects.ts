import { Router } from 'express';
import multer from 'multer';
import {
  canonicalJson,
  ENGINE_VERSION,
  RULE_REGISTRY_VERSION,
  normalizeDependencyKey,
  type Protocol,
} from '@jky/radar-core';
import { ADAPTER_VERSION } from '@jky/radar-adapters';
import {
  createAnalysisSchema,
  createConsumerSchema,
  createVersionSchema,
  LIMITS,
  paginationQuery,
  updatePolicySchema,
  updateProjectSchema,
} from '@jky/shared';
import type { Env } from '../config/env.js';
import { Analysis, Consumer, ConsumerDependency, Policy, SpecFile, SpecVersion } from '../models/index.js';
import { asyncHandler, parse, sendData } from '../lib/http.js';
import { AppError, badRequest, conflict, notFound, quotaExceeded } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { loadProject, loadVersion } from '../services/access.js';
import { audit } from '../services/audit.js';
import { createVersion } from '../services/versions.js';
import { currentPolicy, ensurePolicy, releasePolicyVersion, toReleasePolicy } from '../services/policies.js';
import {
  analysisDTO,
  analysisSummaryDTO,
  consumerDTO,
  policyDTO,
  projectDTO,
  userNames,
  versionDTO,
} from '../services/serialize.js';
import type { AnalysisRunner } from '../services/analysis-runner.js';
import { entityCatalog } from '../services/catalog.js';
import { requireAuth } from '../middleware/auth.js';
import type { RequestHandler } from 'express';

const ALLOWED_EXT = /\.(json|ya?ml|graphql|gql|proto|txt)$/i;

export function projectsRouter(
  env: Env,
  runner: AnalysisRunner,
  limiters: { upload: RequestHandler; analysis: RequestHandler },
) {
  const r = Router();
  r.use(['/projects', '/versions'], requireAuth);
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: env.MAX_SPEC_BYTES, files: 1, fields: 10, fieldSize: 4096, parts: 12 },
  });

  r.get(
    '/projects/:pid',
    asyncHandler(async (req, res) => {
      const { project, access } = await loadProject(req, String(req.params.pid));
      const [lv, la] = await Promise.all([
        project.latestVersionId
          ? SpecVersion.findById(project.latestVersionId).select('label createdAt').lean()
          : null,
        project.latestAnalysisId
          ? Analysis.findById(project.latestAnalysisId).select('gate state createdAt').lean()
          : null,
      ]);
      sendData(res, { ...projectDTO(project.toObject(), lv, la), role: access.role });
    }),
  );

  r.patch(
    '/projects/:pid',
    asyncHandler(async (req, res) => {
      const { project, access } = await loadProject(req, String(req.params.pid), 'project.update');
      const input = parse(updateProjectSchema, req.body);
      const before = { name: project.name, description: project.description };
      if (input.name !== undefined) project.name = input.name;
      if (input.description !== undefined) project.description = input.description;
      await project.save();
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'project.updated',
        resourceType: 'project',
        resourceId: project._id,
        metadata: { before, after: input },
      });
      sendData(res, projectDTO(project.toObject(), null, null));
    }),
  );

  /* ------------------------------------------------------------ versions */
  r.get(
    '/projects/:pid/versions',
    asyncHandler(async (req, res) => {
      const { project } = await loadProject(req, String(req.params.pid));
      const versions = await SpecVersion.find({ projectId: project._id })
        .sort({ createdAt: -1 })
        .limit(LIMITS.maxVersionsPerProject)
        .lean();
      const names = await userNames(versions.map((v) => v.uploadedBy));
      sendData(
        res,
        versions.map((v) => versionDTO(v, names)),
      );
    }),
  );

  r.post(
    '/projects/:pid/versions',
    limiters.upload,
    upload.single('file'),
    asyncHandler(async (req, res) => {
      const { project, access } = await loadProject(req, String(req.params.pid), 'version.create');
      let body: unknown = req.body;
      if (req.file) {
        const name = req.file.originalname;
        if (!ALLOWED_EXT.test(name) || /[\\/\0]/.test(name))
          throw new AppError(
            415,
            'UNSUPPORTED_MEDIA_TYPE',
            'Upload a .json, .yaml, .yml, .graphql, .gql, .proto or .txt contract file.',
          );
        let content: string;
        try {
          content = new TextDecoder('utf-8', { fatal: true }).decode(req.file.buffer);
        } catch {
          throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The file is not valid UTF-8 text.');
        }
        body = {
          ...(req.body as object),
          content,
          fileName: (req.body as { fileName?: string })?.fileName || name,
        };
      }
      const input = parse(createVersionSchema, body);
      const version = await createVersion(project, access.userId, input, env.MAX_SPEC_BYTES);
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'version.uploaded',
        resourceType: 'version',
        resourceId: version._id,
        metadata: {
          projectId: project._id.toString(),
          label: version.label,
          protocol: version.protocol,
          rawHash: version.rawHash,
          redactions: version.redactions.length,
        },
      });
      const names = await userNames([access.userId]);
      sendData(res, versionDTO(version.toObject(), names), 201);
    }),
  );

  r.get(
    '/versions/:vid',
    asyncHandler(async (req, res) => {
      const { version } = await loadVersion(req, String(req.params.vid));
      const names = await userNames([version.uploadedBy]);
      sendData(res, versionDTO(version.toObject(), names));
    }),
  );

  r.get(
    '/versions/:vid/content',
    asyncHandler(async (req, res) => {
      const { version } = await loadVersion(req, String(req.params.vid));
      const file = await SpecFile.findById(version.specFileId).lean();
      if (!file) throw notFound('Version content');
      sendData(res, {
        content: file.content,
        fileName: version.fileName ?? null,
        label: version.label,
        rawHash: version.rawHash,
      });
    }),
  );

  r.get(
    '/projects/:pid/entities',
    asyncHandler(async (req, res) => {
      const { project } = await loadProject(req, String(req.params.pid));
      if (!project.latestVersionId) return void sendData(res, []);
      const v = await SpecVersion.findById(project.latestVersionId).lean();
      const f = v ? await SpecFile.findById(v.specFileId).lean() : null;
      sendData(
        res,
        v && f
          ? entityCatalog(f.content, v.protocol as Protocol, v.fileName ?? undefined).slice(0, 1000)
          : [],
      );
    }),
  );

  /* ------------------------------------------------------------ analyses */
  r.post(
    '/projects/:pid/analyses',
    limiters.analysis,
    asyncHandler(async (req, res) => {
      const { project, access } = await loadProject(req, String(req.params.pid), 'analysis.create');
      const input = parse(createAnalysisSchema, req.body);
      if (input.baselineId === input.candidateId)
        throw badRequest('Choose two different versions to compare.');
      const [bv, cv] = await Promise.all([
        SpecVersion.findOne({ _id: input.baselineId, projectId: project._id }).lean(),
        SpecVersion.findOne({ _id: input.candidateId, projectId: project._id }).lean(),
      ]);
      if (!bv || !cv) throw notFound('Version in this project');
      if (bv.protocol !== cv.protocol && !input.options.allowCrossFormat) {
        throw new AppError(
          422,
          'PROTOCOL_MISMATCH',
          `Baseline is ${bv.protocol} and candidate is ${cv.protocol}. Enable cross-format comparison to compare them.`,
        );
      }
      const policy = await ensurePolicy(project.workspaceId, project._id, access.userId);
      const options = { includeInformational: true, ...input.options };
      const inputHash = sha256(
        canonicalJson({
          b: bv.rawHash,
          c: cv.rawHash,
          engine: ENGINE_VERSION,
          rules: RULE_REGISTRY_VERSION,
          adapter: ADAPTER_VERSION,
          policy: releasePolicyVersion(policy),
          options,
        }),
      );
      const existing = await Analysis.findOne({ projectId: project._id, inputHash });
      if (existing && existing.state !== 'failed') {
        const names = await userNames([existing.createdBy]);
        return void sendData(res, { ...analysisDTO(existing.toObject(), bv, cv, names), cached: true }, 200);
      }
      if (existing) await existing.deleteOne();
      const analysis = await Analysis.create({
        workspaceId: project.workspaceId,
        projectId: project._id,
        baselineId: bv._id,
        candidateId: cv._id,
        protocol: cv.protocol,
        inputHash,
        options,
        policyId: policy._id,
        policyRevision: policy.revision,
        policyName: policy.name,
        policySnapshot: toReleasePolicy(policy),
        createdBy: access.userId,
        timings: { queuedAt: new Date() },
      });
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'analysis.requested',
        resourceType: 'analysis',
        resourceId: analysis._id,
        metadata: { baseline: bv.label, candidate: cv.label, policyRevision: policy.revision },
      });
      runner.enqueue(analysis._id.toString());
      const names = await userNames([access.userId]);
      sendData(res, analysisDTO(analysis.toObject(), bv, cv, names), 202);
    }),
  );

  r.get(
    '/projects/:pid/analyses',
    asyncHandler(async (req, res) => {
      const { project } = await loadProject(req, String(req.params.pid));
      const q = parse(paginationQuery, req.query);
      const [items, total] = await Promise.all([
        Analysis.find({ projectId: project._id })
          .sort({ createdAt: -1 })
          .skip((q.page - 1) * q.pageSize)
          .limit(q.pageSize)
          .lean(),
        Analysis.countDocuments({ projectId: project._id }),
      ]);
      const labels = await SpecVersion.find({ projectId: project._id }).select('label').lean();
      const lm = new Map(labels.map((v) => [v._id.toString(), v.label]));
      const names = await userNames(items.map((a) => a.createdBy));
      sendData(
        res,
        items.map((a) => analysisSummaryDTO(a, lm, names, project.name)),
        200,
        { page: q.page, pageSize: q.pageSize, total, totalPages: Math.ceil(total / q.pageSize) },
      );
    }),
  );

  /* ------------------------------------------------------------ consumers */
  r.get(
    '/projects/:pid/consumers',
    asyncHandler(async (req, res) => {
      const { project } = await loadProject(req, String(req.params.pid));
      const [cs, deps] = await Promise.all([
        Consumer.find({ projectId: project._id }).sort({ name: 1 }).lean(),
        ConsumerDependency.find({ projectId: project._id }).sort({ operationKey: 1 }).lean(),
      ]);
      sendData(
        res,
        cs.map((c) =>
          consumerDTO(
            c,
            deps.filter((d) => d.consumerId.equals(c._id)),
          ),
        ),
      );
    }),
  );

  r.post(
    '/projects/:pid/consumers',
    asyncHandler(async (req, res) => {
      const { project, access } = await loadProject(req, String(req.params.pid), 'consumer.manage');
      const input = parse(createConsumerSchema, req.body);
      if ((await Consumer.countDocuments({ projectId: project._id })) >= LIMITS.maxConsumersPerProject)
        throw quotaExceeded('Consumer limit reached for this project.');
      if (await Consumer.exists({ projectId: project._id, name: input.name }))
        throw conflict('A consumer with this name already exists.');
      const c = await Consumer.create({
        ...input,
        workspaceId: project.workspaceId,
        projectId: project._id,
        createdBy: access.userId,
      });
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'consumer.created',
        resourceType: 'consumer',
        resourceId: c._id,
        metadata: { name: c.name, criticality: c.criticality },
      });
      sendData(res, consumerDTO(c.toObject(), []), 201);
    }),
  );

  /* ------------------------------------------------------------ policy */
  r.get(
    '/projects/:pid/policy',
    asyncHandler(async (req, res) => {
      const { project } = await loadProject(req, String(req.params.pid));
      await ensurePolicy(project.workspaceId, project._id);
      const history = await Policy.find({ projectId: project._id }).sort({ revision: -1 }).limit(50);
      const names = await userNames(history.map((p) => p.updatedBy));
      sendData(res, {
        current: policyDTO(history[0]!, names),
        history: history.map((p) => policyDTO(p, names)),
      });
    }),
  );

  r.put(
    '/projects/:pid/policy',
    asyncHandler(async (req, res) => {
      const { project, access } = await loadProject(req, String(req.params.pid), 'policy.update');
      const input = parse(updatePolicySchema, req.body);
      const prev =
        (await currentPolicy(project._id)) ??
        (await ensurePolicy(project.workspaceId, project._id, access.userId));
      const now = new Date();
      const prevOverrides = new Map((prev.ruleOverrides ?? []).map((o) => [o.ruleId, o]));
      const next = await Policy.create({
        ...input,
        ruleOverrides: input.ruleOverrides.map((o) => {
          const old = prevOverrides.get(o.ruleId);
          const unchanged = old && old.severity === o.severity && old.justification === o.justification;
          return {
            ...o,
            addedBy: unchanged ? old.addedBy : req.auth!.user.name,
            addedAt: unchanged ? old.addedAt : now,
          };
        }),
        workspaceId: project.workspaceId,
        projectId: project._id,
        revision: prev.revision + 1,
        updatedBy: access.userId,
      });
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'policy.updated',
        resourceType: 'policy',
        resourceId: next._id,
        metadata: {
          projectId: project._id.toString(),
          revision: next.revision,
          overrides: input.ruleOverrides.map((o) => `${o.ruleId}→${o.severity}`),
        },
      });
      const names = await userNames([access.userId]);
      sendData(res, policyDTO(next, names), 201);
    }),
  );

  return r;
}

export { normalizeDependencyKey };
