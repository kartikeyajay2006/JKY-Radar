/** @import { Types } from 'mongoose' */
/** @import { ReleasePolicy } from '@jky/radar-core' */

import { DEFAULT_POLICY, policyVersion } from '@jky/radar-core';
import { Policy } from '../models/index.js';

/** @typedef {NonNullable<Awaited<ReturnType<typeof currentPolicy>>>} PolicyDoc */

/** @param {Types.ObjectId} projectId */
export async function currentPolicy(projectId) {
  return Policy.findOne({ projectId }).sort({ revision: -1 });
}

/**
 * @param {Types.ObjectId} workspaceId
 * @param {Types.ObjectId} projectId
 * @param {Types.ObjectId} [userId]
 */
export async function ensurePolicy(workspaceId, projectId, userId) {
  const existing = await currentPolicy(projectId);
  if (existing) return existing;
  const d = DEFAULT_POLICY;
  try {
    return await Policy.create({
      workspaceId,
      projectId,
      name: d.name,
      revision: 1,
      actions: d.actions,
      onCoverageGap: d.onCoverageGap,
      onPartialCoverage: d.onPartialCoverage,
      ruleOverrides: [],
      requireReview: d.requireReview,
      forbidSelfApproval: d.forbidSelfApproval,
      minApprovals: d.minApprovals,
      protectedEnvironments: d.protectedEnvironments,
      updatedBy: userId,
    });
  } catch {
    return await currentPolicy(projectId);
  }
}

/**
 * @param {PolicyDoc} p
 * @returns {ReleasePolicy}
 */
export function toReleasePolicy(p) {
  return {
    id: `project-${p.projectId.toString()}`,
    name: p.name,
    revision: p.revision,
    actions: /** @type {ReleasePolicy['actions']} */ (p.actions),
    onCoverageGap: /** @type {ReleasePolicy['onCoverageGap']} */ (p.onCoverageGap),
    onPartialCoverage: /** @type {ReleasePolicy['onPartialCoverage']} */ (p.onPartialCoverage),
    ruleOverrides: (p.ruleOverrides ?? []).map((o) => ({
      ruleId: o.ruleId,
      severity: /** @type {ReleasePolicy['ruleOverrides'][number]['severity']} */ (o.severity),
      justification: o.justification ?? '',
    })),
    requireReview: p.requireReview,
    forbidSelfApproval: p.forbidSelfApproval,
    minApprovals: p.minApprovals,
    protectedEnvironments: p.protectedEnvironments,
  };
}

/** @param {PolicyDoc} p */
export const releasePolicyVersion = (p) => policyVersion(toReleasePolicy(p));
