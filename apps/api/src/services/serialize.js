/** @import { Types } from 'mongoose' */
/** @import { AnalysisDTO, AnalysisSummaryDTO, ConsumerDTO, PolicyDTO, ProjectDTO, VersionDTO } from '@jky/shared' */
/** @import { PolicyDoc } from './policies.js' */

import { User } from '../models/index.js';
import { releasePolicyVersion } from './policies.js';

/** @param {Date | null} [d] */
const iso = (d) => (d ? new Date(d).toISOString() : undefined);

/**
 * @param {Array<Types.ObjectId | undefined | null>} ids
 * @returns {Promise<Map<string, string>>}
 */
export async function userNames(ids) {
  const unique = [...new Set(ids.filter(Boolean).map((i) => i.toString()))];
  const users = await User.find({ _id: { $in: unique } })
    .select('name')
    .lean();
  return new Map(users.map((u) => [u._id.toString(), u.name]));
}

/**
 * @param {any} v
 * @param {Map<string, string>} names
 * @returns {VersionDTO}
 */
export function versionDTO(v, names) {
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
    redactions: (v.redactions ?? []).map(/** @param {any} r */ (r) => ({ line: r.line, reason: r.reason })),
    detection: {
      confidence: v.detection?.confidence ?? 'unknown',
      reasons: v.detection?.reasons ?? [],
      overridden: !!v.detection?.overridden,
    },
    notes: v.notes ?? undefined,
    uploadedBy: { id: v.uploadedBy.toString(), name: names.get(v.uploadedBy.toString()) ?? 'Unknown' },
    createdAt: iso(v.createdAt),
  };
}

/**
 * @param {any} p
 * @param {any | null} latestVersion
 * @param {any | null} latestAnalysis
 * @returns {ProjectDTO}
 */
export function projectDTO(p, latestVersion, latestAnalysis) {
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
          createdAt: iso(latestVersion.createdAt),
        }
      : null,
    latestAnalysis: latestAnalysis
      ? {
          id: latestAnalysis._id.toString(),
          gate: latestAnalysis.gate?.decision ?? null,
          state: latestAnalysis.state,
          createdAt: iso(latestAnalysis.createdAt),
        }
      : null,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
  };
}

/**
 * @param {any} a
 * @param {Map<string, string>} labels
 * @param {Map<string, string>} names
 * @param {string} [projectName]
 * @returns {AnalysisSummaryDTO}
 */
export function analysisSummaryDTO(a, labels, names, projectName) {
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
    createdAt: iso(a.createdAt),
    ...(a.timings?.completedAt ? { completedAt: iso(a.timings.completedAt) } : {}),
    isPublicDemo: !!a.isPublicDemo,
  };
}

/** @param {any} v */
const versionRef = (v) => ({
  id: v._id.toString(),
  label: v.label,
  rawHash: v.rawHash,
  fileName: v.fileName ?? undefined,
  formatVersion: v.formatVersion,
  createdAt: iso(v.createdAt),
});

/**
 * @param {any} a
 * @param {any} baseline
 * @param {any} candidate
 * @param {Map<string, string>} names
 * @returns {AnalysisDTO}
 */
export function analysisDTO(a, baseline, candidate, names) {
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
      queuedAt: iso(a.timings?.queuedAt ?? a.createdAt),
      ...(a.timings?.startedAt ? { startedAt: iso(a.timings.startedAt) } : {}),
      ...(a.timings?.completedAt ? { completedAt: iso(a.timings.completedAt) } : {}),
      ...(a.timings?.durationMs !== undefined ? { durationMs: a.timings.durationMs } : {}),
    },
  };
}

/** @param {any} f */
export function findingDTO(f) {
  const { _id, workspaceId: _w, analysisId: _a, createdAt: _c, ...rest } = f;
  return { id: _id.toString(), ...rest };
}

/**
 * @param {any} c
 * @param {any[]} deps
 * @returns {ConsumerDTO}
 */
export function consumerDTO(c, deps) {
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
      lastConfirmedAt: iso(d.lastConfirmedAt),
    })),
    createdAt: iso(c.createdAt),
  };
}

/**
 * @param {PolicyDoc} p
 * @param {Map<string, string>} names
 * @returns {PolicyDTO}
 */
export function policyDTO(p, names) {
  const updatedBy = p.updatedBy
    ? { id: p.updatedBy.toString(), name: names.get(p.updatedBy.toString()) ?? 'Unknown' }
    : null;
  return {
    id: p._id.toString(),
    projectId: p.projectId.toString(),
    name: p.name,
    revision: p.revision,
    actions: p.actions,
    onCoverageGap: /** @type {PolicyDTO['onCoverageGap']} */ (p.onCoverageGap),
    onPartialCoverage: /** @type {PolicyDTO['onPartialCoverage']} */ (p.onPartialCoverage),
    ruleOverrides: (p.ruleOverrides ?? []).map(
      /** @param {any} o */ (o) => ({
        ruleId: o.ruleId,
        severity: o.severity,
        justification: o.justification,
        addedBy: o.addedBy,
        addedAt: iso(o.addedAt),
      }),
    ),
    requireReview: p.requireReview,
    forbidSelfApproval: p.forbidSelfApproval,
    minApprovals: p.minApprovals,
    protectedEnvironments: p.protectedEnvironments,
    version: releasePolicyVersion(p),
    updatedBy,
    createdAt: iso(p.createdAt),
  };
}
