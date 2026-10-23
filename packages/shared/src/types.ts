import type {
  AnalysisOptions,
  ComparisonMode,
  ContractSummary,
  CoverageReport,
  Diagnostic,
  Finding,
  FindingSeverity,
  GateResult,
  ImpactReport,
  Protocol,
} from '@jky/radar-core';
import type { AnalysisState, ErrorCode, ReviewDecision, Role } from './constants.js';

export interface ApiErrorBody {
  error: { code: ErrorCode | string; message: string; details?: unknown; requestId: string };
}
export interface ApiData<T, M = undefined> {
  data: T;
  meta?: M;
}
export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  preferences: { theme: 'system' | 'light' | 'dark' };
  createdAt: string;
}
export interface SessionDTO {
  user: UserDTO;
  csrfToken: string;
}

export interface WorkspaceDTO {
  id: string;
  name: string;
  slug: string;
  role: Role;
  isDemo: boolean;
  createdAt: string;
  counts?: { projects: number; members: number };
}
export interface MemberDTO {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: Role;
  status: 'active' | 'invited';
  createdAt: string;
}
export interface InvitationDTO {
  id: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  invitedBy: string;
  createdAt: string;
}

export interface ProjectDTO {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string;
  protocol: Protocol;
  versionCount: number;
  latestVersion: { id: string; label: string; createdAt: string } | null;
  latestAnalysis: {
    id: string;
    gate: GateResult['decision'] | null;
    state: AnalysisState;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface VersionDTO {
  id: string;
  projectId: string;
  label: string;
  protocol: Protocol;
  formatVersion: string;
  title?: string;
  apiVersion?: string;
  fileName?: string;
  size: number;
  rawHash: string;
  normalizedHash: string;
  stats: Record<string, number>;
  diagnostics: Diagnostic[];
  ignoredConstructs: string[];
  redactions: Array<{ line: number; reason: string }>;
  detection: { confidence: string; reasons: string[]; overridden: boolean };
  notes?: string;
  uploadedBy: { id: string; name: string };
  createdAt: string;
}

export interface AnalysisSummaryDTO {
  id: string;
  projectId: string;
  projectName?: string;
  protocol: Protocol;
  state: AnalysisState;
  stage: string;
  gate: GateResult['decision'] | null;
  counts: Record<FindingSeverity, number> | null;
  coverageLevel: CoverageReport['level'] | null;
  baseline: { id: string; label: string };
  candidate: { id: string; label: string };
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'not_required';
  createdBy: { id: string; name: string };
  createdAt: string;
  completedAt?: string;
  isPublicDemo: boolean;
}

export interface AnalysisDTO extends AnalysisSummaryDTO {
  workspaceId: string;
  comparisonMode: ComparisonMode | null;
  options: AnalysisOptions;
  gateResult: GateResult | null;
  coverage: CoverageReport | null;
  baselineSummary: ContractSummary | null;
  candidateSummary: ContractSummary | null;
  baselineVersion: Pick<VersionDTO, 'id' | 'label' | 'rawHash' | 'fileName' | 'formatVersion' | 'createdAt'>;
  candidateVersion: Pick<VersionDTO, 'id' | 'label' | 'rawHash' | 'fileName' | 'formatVersion' | 'createdAt'>;
  uncoveredConstructs: string[];
  parserWarnings: Diagnostic[];
  versions: { engine: string; rules: string; adapter: string; policy: string } | null;
  policy: { id: string; name: string; revision: number } | null;
  inputHash: string;
  error?: { code: string; message: string; details?: unknown };
  timings: { queuedAt: string; startedAt?: string; completedAt?: string; durationMs?: number };
  cached?: boolean;
}

export type FindingDTO = Finding & { id: string; index: number };

export interface ConsumerDTO {
  id: string;
  projectId: string;
  name: string;
  owner: string;
  team: string;
  contact: string;
  criticality: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  dependencies: Array<{
    id: string;
    operationKey: string;
    normalizedKey: string;
    evidenceSource: string;
    notes: string;
    lastConfirmedAt: string;
  }>;
  createdAt: string;
}

export interface PolicyDTO {
  id: string;
  projectId: string;
  name: string;
  revision: number;
  actions: Record<FindingSeverity, 'block' | 'warn' | 'ignore'>;
  onCoverageGap: 'inconclusive' | 'warn';
  onPartialCoverage: 'warn' | 'pass';
  ruleOverrides: Array<{
    ruleId: string;
    severity: FindingSeverity;
    justification: string;
    addedBy?: string;
    addedAt?: string;
  }>;
  requireReview: boolean;
  forbidSelfApproval: boolean;
  minApprovals: number;
  protectedEnvironments: string[];
  version: string;
  updatedBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface ReviewDTO {
  id: string;
  analysisId: string;
  reviewer: { id: string; name: string };
  decision: ReviewDecision;
  rationale: string;
  overrideBlock: boolean;
  createdAt: string;
}

export interface NotificationDTO {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  workspaceId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface AuditEventDTO {
  id: string;
  actor: { id: string; name: string } | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  requestId?: string;
  createdAt: string;
}

export interface OverviewDTO {
  counts: {
    projects: number;
    versions: number;
    analyses: number;
    consumers: number;
    blocked: number;
    pendingReviews: number;
  };
  severityTotals: Record<FindingSeverity, number>;
  gateTotals: Record<'pass' | 'warn' | 'block' | 'inconclusive', number>;
  timeline: Array<{ date: string; analyses: number; blocked: number }>;
  topEntities: Array<{ entityKey: string; count: number; worst: FindingSeverity }>;
  topConsumers: Array<{ consumerId: string; name: string; criticality: string; impactedAnalyses: number }>;
  reviewCompletion: { reviewed: number; total: number };
  recentAnalyses: AnalysisSummaryDTO[];
}

export type ImpactDTO = ImpactReport;
