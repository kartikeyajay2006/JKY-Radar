import type { Types } from 'mongoose';
import { DEFAULT_POLICY, policyVersion, type ReleasePolicy } from '@jky/radar-core';
import { Policy } from '../models/index.js';

export type PolicyDoc = NonNullable<Awaited<ReturnType<typeof currentPolicy>>>;

export async function currentPolicy(projectId: Types.ObjectId) {
  return Policy.findOne({ projectId }).sort({ revision: -1 });
}

export async function ensurePolicy(
  workspaceId: Types.ObjectId,
  projectId: Types.ObjectId,
  userId?: Types.ObjectId,
) {
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
    return (await currentPolicy(projectId))!;
  }
}

export function toReleasePolicy(p: PolicyDoc): ReleasePolicy {
  return {
    id: `project-${p.projectId.toString()}`,
    name: p.name,
    revision: p.revision,
    actions: p.actions as ReleasePolicy['actions'],
    onCoverageGap: p.onCoverageGap as ReleasePolicy['onCoverageGap'],
    onPartialCoverage: p.onPartialCoverage as ReleasePolicy['onPartialCoverage'],
    ruleOverrides: (p.ruleOverrides ?? []).map((o) => ({
      ruleId: o.ruleId!,
      severity: o.severity as ReleasePolicy['ruleOverrides'][number]['severity'],
      justification: o.justification ?? '',
    })),
    requireReview: p.requireReview,
    forbidSelfApproval: p.forbidSelfApproval,
    minApprovals: p.minApprovals,
    protectedEnvironments: p.protectedEnvironments,
  };
}

export const releasePolicyVersion = (p: PolicyDoc) => policyVersion(toReleasePolicy(p));
