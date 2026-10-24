import { canonicalJson, ENGINE_VERSION, RULE_REGISTRY_VERSION } from '@jky/radar-core';
import { ADAPTER_VERSION } from '@jky/radar-adapters';
import { Analysis } from '../models/index.js';
import { AppError } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';
import { audit } from './audit.js';
import { ensurePolicy, releasePolicyVersion, toReleasePolicy } from './policies.js';

/** @import { Types } from 'mongoose' */
/** @import { AppRequest } from '../types.js' */
/** @import { AnalysisRunner } from './analysis-runner.js' */

/**
 * @typedef {Object} AnalysisRequest
 * @property {{ _id: Types.ObjectId; workspaceId: Types.ObjectId }} project
 * @property {{ _id: Types.ObjectId; label: string; protocol: string; rawHash: string }} baseline
 * @property {{ _id: Types.ObjectId; label: string; protocol: string; rawHash: string }} candidate
 * @property {Record<string, unknown> & { allowCrossFormat?: boolean; operationAliases?: Record<string, string> }} options
 * @property {Types.ObjectId} actorId
 * @property {Record<string, unknown>} [auditMetadata]
 */

/**
 * Creates (or reuses) an analysis of two stored versions and queues it. Shared by the web
 * app's compare flow and the CI endpoint so both follow exactly the same rules.
 * Identical inputs under the same engine, rules and policy return the existing analysis.
 * @param {AppRequest} req
 * @param {AnalysisRunner} runner
 * @param {AnalysisRequest} input
 */
export async function requestAnalysis(req, runner, input) {
  const { project, baseline: bv, candidate: cv, actorId } = input;
  if (bv.protocol !== cv.protocol && !input.options.allowCrossFormat) {
    throw new AppError(
      422,
      'PROTOCOL_MISMATCH',
      `Baseline is ${bv.protocol} and candidate is ${cv.protocol}. Enable cross-format comparison to compare them.`,
    );
  }
  const policy = await ensurePolicy(project.workspaceId, project._id, actorId);
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
  if (existing && existing.state !== 'failed') return { analysis: existing, cached: true };
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
    createdBy: actorId,
    timings: { queuedAt: new Date() },
  });
  await audit(req, {
    workspaceId: project.workspaceId,
    actorId,
    action: 'analysis.requested',
    resourceType: 'analysis',
    resourceId: analysis._id,
    metadata: {
      baseline: bv.label,
      candidate: cv.label,
      policyRevision: policy.revision,
      ...(options.operationAliases && Object.keys(options.operationAliases).length
        ? { operationAliases: options.operationAliases }
        : {}),
      ...input.auditMetadata,
    },
  });
  runner.enqueue(analysis._id.toString());
  return { analysis, cached: false };
}
