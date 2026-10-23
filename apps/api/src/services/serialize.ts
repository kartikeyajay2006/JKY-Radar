import type { Types } from 'mongoose';
import type {
  AnalysisDTO,
  AnalysisSummaryDTO,
  ConsumerDTO,
  PolicyDTO,
  ProjectDTO,
  VersionDTO,
} from '@jky/shared';
import { User } from '../models/index.js';
import { releasePolicyVersion, type PolicyDoc } from './policies.js';

const iso = (d?: Date | null) => (d ? new Date(d).toISOString() : undefined);

export async function userNames(ids: Array<Types.ObjectId | undefined | null>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean).map((i) => i!.toString()))];
  const users = await User.find({ _id: { $in: unique } })
    .select('name')
    .lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

/* eslint-disable @typescript-eslint/no-explicit-any -- mongoose lean documents are loosely typed */
export function versionDTO(v: any, names: Map<string, string>): VersionDTO {
  return {
    id: v._id.toString(),
    projectId: v.projectId.toString(),
    label: v.label,
    protocol: v.protocol,
    formatVersion: v.formatVersion,
    title: v.title ?? undefined,
    apiVersion: v.apiVersion ?? undefined,
    fileName: v.fileName ?? undefined,
    size: v.size,
    rawHash: v.rawHash,
    normalizedHash: v.normalizedHash,
    stats: v.stats ?? {},
    diagnostics: v.diagnostics ?? [],
    ignoredConstructs: v.ignoredConstructs ?? [],
    redactions: (v.redactions ?? []).map((r: any) => ({ line: r.line, reason: r.reason })),
    detection: {
      confidence: v.detection?.confidence ?? 'unknown',
      reasons: v.detection?.reasons ?? [],
      overridden: !!v.detection?.overridden,
    },
    notes: v.notes ?? undefined,
    uploadedBy: { id: v.uploadedBy.toString(), name: names.get(v.uploadedBy.toString()) ?? 'Unknown' },
    createdAt: iso(v.createdAt)!,
  };
}

export function projectDTO(p: any, latestVersion: any | null, latestAnalysis: any | null): ProjectDTO {
  return {
    id: p._id.toString(),
    workspaceId: p.workspaceId.toString(),
    name: p.name,
    slug: p.slug,
    description: p.description ?? '',
    protocol: p.protocol,
    versionCount: p.versionCount ?? 0,
    latestVersion: latestVersion
      ? {
          id: latestVersion._id.toString(),
          label: latestVersion.label,
          createdAt: iso(latestVersion.createdAt)!,
        }
      : null,
    latestAnalysis: latestAnalysis
      ? {
          id: latestAnalysis._id.toString(),
          gate: latestAnalysis.gate?.decision ?? null,
          state: latestAnalysis.state,
          createdAt: iso(latestAnalysis.createdAt)!,
        }
      : null,
    createdAt: iso(p.createdAt)!,
    updatedAt: iso(p.updatedAt)!,
  };
}

export function analysisSummaryDTO(
  a: any,
  labels: Map<string, string>,
  names: Map<string, string>,
  projectName?: string,
): AnalysisSummaryDTO {
  return {
    id: a._id.toString(),
    projectId: a.projectId.toString(),
    ...(projectName ? { projectName } : {}),
    protocol: a.protocol,
    state: a.state,
    stage: a.stage,
    gate: a.gate?.decision ?? null,
    counts: a.counts ?? null,
    coverageLevel: a.coverage?.level ?? null,
    baseline: { id: a.baselineId.toString(), label: labels.get(a.baselineId.toString()) ?? '?' },
    candidate: { id: a.candidateId.toString(), label: labels.get(a.candidateId.toString()) ?? '?' },
    reviewStatus: a.reviewStatus,
    createdBy: { id: a.createdBy.toString(), name: names.get(a.createdBy.toString()) ?? 'Unknown' },
    createdAt: iso(a.createdAt)!,
    ...(a.timings?.completedAt ? { completedAt: iso(a.timings.completedAt)! } : {}),
    isPublicDemo: !!a.isPublicDemo,
  };
}

const versionRef = (v: any) => ({
  id: v._id.toString(),
  label: v.label,
  rawHash: v.rawHash,
  fileName: v.fileName ?? undefined,
  formatVersion: v.formatVersion,
  createdAt: iso(v.createdAt)!,
});

export function analysisDTO(a: any, baseline: any, candidate: any, names: Map<string, string>): AnalysisDTO {
  const labels = new Map([
    [baseline._id.toString(), baseline.label],
    [candidate._id.toString(), candidate.label],
  ]);
  return {
    ...analysisSummaryDTO(a, labels, names),
    workspaceId: a.workspaceId.toString(),
    comparisonMode: a.comparisonMode ?? null,
    options: a.options ?? {},
    gateResult: a.gate ?? null,
    coverage: a.coverage ?? null,
    baselineSummary: a.baselineSummary ?? null,
    candidateSummary: a.candidateSummary ?? null,
    baselineVersion: versionRef(baseline),
    candidateVersion: versionRef(candidate),
    uncoveredConstructs: a.uncoveredConstructs ?? [],
    parserWarnings: a.parserWarnings ?? [],
    versions: a.versions?.engine
      ? {
          engine: a.versions.engine,
          rules: a.versions.rules,
          adapter: a.versions.adapter,
          policy: a.versions.policy,
        }
      : null,
    policy: a.policyId
      ? { id: a.policyId.toString(), name: a.policyName ?? 'Policy', revision: a.policyRevision ?? 1 }
      : null,
    inputHash: a.inputHash,
    ...(a.error ? { error: a.error } : {}),
    timings: {
      queuedAt: iso(a.timings?.queuedAt ?? a.createdAt)!,
      ...(a.timings?.startedAt ? { startedAt: iso(a.timings.startedAt)! } : {}),
      ...(a.timings?.completedAt ? { completedAt: iso(a.timings.completedAt)! } : {}),
      ...(a.timings?.durationMs !== undefined ? { durationMs: a.timings.durationMs } : {}),
    },
  };
}

export function findingDTO(f: any) {
  const { _id, workspaceId: _w, analysisId: _a, createdAt: _c, ...rest } = f;
  return { id: _id.toString(), ...rest };
}

export function consumerDTO(c: any, deps: any[]): ConsumerDTO {
  return {
    id: c._id.toString(),
    projectId: c.projectId.toString(),
    name: c.name,
    owner: c.owner ?? '',
    team: c.team ?? '',
    contact: c.contact ?? '',
    criticality: c.criticality,
    description: c.description ?? '',
    dependencies: deps.map((d) => ({
      id: d._id.toString(),
      operationKey: d.operationKey,
      normalizedKey: d.normalizedKey,
      evidenceSource: d.evidenceSource,
      notes: d.notes ?? '',
      lastConfirmedAt: iso(d.lastConfirmedAt)!,
    })),
    createdAt: iso(c.createdAt)!,
  };
}

export function policyDTO(p: PolicyDoc, names: Map<string, string>): PolicyDTO {
  const updatedBy = p.updatedBy
    ? { id: p.updatedBy.toString(), name: names.get(p.updatedBy.toString()) ?? 'Unknown' }
    : null;
  return {
    id: p._id.toString(),
    projectId: p.projectId.toString(),
    name: p.name,
    revision: p.revision,
    actions: p.actions,
    onCoverageGap: p.onCoverageGap as PolicyDTO['onCoverageGap'],
    onPartialCoverage: p.onPartialCoverage as PolicyDTO['onPartialCoverage'],
    ruleOverrides: (p.ruleOverrides ?? []).map((o: any) => ({
      ruleId: o.ruleId,
      severity: o.severity,
      justification: o.justification,
      addedBy: o.addedBy,
      addedAt: iso(o.addedAt),
    })),
    requireReview: p.requireReview,
    forbidSelfApproval: p.forbidSelfApproval,
    minApprovals: p.minApprovals,
    protectedEnvironments: p.protectedEnvironments,
    version: releasePolicyVersion(p),
    updatedBy,
    createdAt: iso(p.createdAt)!,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
