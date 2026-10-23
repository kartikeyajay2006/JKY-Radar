export const ROLES = ['OWNER', 'ADMIN', 'MAINTAINER', 'REVIEWER', 'VIEWER'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_RANK: Record<Role, number> = { OWNER: 5, ADMIN: 4, MAINTAINER: 3, REVIEWER: 2, VIEWER: 1 };

export const ROLE_DESCRIPTION: Record<Role, string> = {
  OWNER: 'Full control including deleting the workspace and transferring ownership.',
  ADMIN: 'Manage members, roles and release policies.',
  MAINTAINER: 'Create projects, upload versions, run analyses and manage consumers.',
  REVIEWER: 'Approve, reject or request changes on analyses.',
  VIEWER: 'Read-only access to projects, analyses and reports.',
};

/** Minimum role per action. Enforced server-side; mirrored in the UI only for display. */
export const PERMISSIONS = {
  'workspace.read': 'VIEWER',
  'workspace.update': 'ADMIN',
  'members.manage': 'ADMIN',
  'project.create': 'MAINTAINER',
  'project.update': 'MAINTAINER',
  'version.create': 'MAINTAINER',
  'analysis.create': 'MAINTAINER',
  'consumer.manage': 'MAINTAINER',
  'policy.update': 'ADMIN',
  'review.create': 'REVIEWER',
  'audit.read': 'ADMIN',
} as const satisfies Record<string, Role>;
export type Permission = keyof typeof PERMISSIONS;

export function roleAllows(role: Role, permission: Permission): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[PERMISSIONS[permission]];
}

export const CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const;
export const REVIEW_DECISIONS = ['approve', 'reject', 'request_changes', 'comment'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const ANALYSIS_STATES = ['queued', 'running', 'completed', 'failed'] as const;
export type AnalysisState = (typeof ANALYSIS_STATES)[number];
export const ANALYSIS_STAGES = ['queued', 'parsing', 'comparing', 'gating', 'persisting', 'done'] as const;

export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'CSRF_FAILED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'INVALID_CONTRACT',
  'PROTOCOL_MISMATCH',
  'ANALYSIS_FAILED',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const LIMITS = {
  maxSpecBytes: 2 * 1024 * 1024,
  maxProjectsPerWorkspace: 100,
  maxVersionsPerProject: 300,
  maxConsumersPerProject: 200,
  maxDependenciesPerConsumer: 300,
  maxWorkspacesPerUser: 20,
  findingsPageSizeMax: 200,
} as const;

export const CSRF_HEADER = 'x-csrf-token';
