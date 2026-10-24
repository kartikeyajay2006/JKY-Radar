export const ROLES = /** @type {const} */ (['OWNER', 'ADMIN', 'MAINTAINER', 'REVIEWER', 'VIEWER']);
/** @typedef {(typeof ROLES)[number]} Role */

/** @type {Record<Role, number>} */
export const ROLE_RANK = { OWNER: 5, ADMIN: 4, MAINTAINER: 3, REVIEWER: 2, VIEWER: 1 };

/** @type {Record<Role, string>} */
export const ROLE_DESCRIPTION = {
  OWNER: 'Full control including deleting the workspace and transferring ownership.',
  ADMIN: 'Manage members, roles and release policies.',
  MAINTAINER: 'Create projects, upload versions, run analyses and manage consumers.',
  REVIEWER: 'Approve, reject or request changes on analyses.',
  VIEWER: 'Read-only access to projects, analyses and reports.',
};

/** Minimum role per action. Enforced server-side; mirrored in the UI only for display. */
export const PERMISSIONS = /** @satisfies {Record<string, Role>} */ (
  /** @type {const} */ ({
    'workspace.read': 'VIEWER',
    'workspace.update': 'ADMIN',
    'members.manage': 'ADMIN',
    'project.create': 'MAINTAINER',
    'project.update': 'MAINTAINER',
    'version.create': 'MAINTAINER',
    'analysis.create': 'MAINTAINER',
    'consumer.manage': 'MAINTAINER',
    'policy.update': 'ADMIN',
    'token.manage': 'ADMIN',
    'review.create': 'REVIEWER',
    'audit.read': 'ADMIN',
  })
);
/** @typedef {keyof typeof PERMISSIONS} Permission */

/**
 * @param {Role} role
 * @param {Permission} permission
 * @returns {boolean}
 */
export function roleAllows(role, permission) {
  return ROLE_RANK[role] >= ROLE_RANK[PERMISSIONS[permission]];
}

export const CRITICALITIES = /** @type {const} */ (['low', 'medium', 'high', 'critical']);
export const REVIEW_DECISIONS = /** @type {const} */ (['approve', 'reject', 'request_changes', 'comment']);
/** @typedef {(typeof REVIEW_DECISIONS)[number]} ReviewDecision */
export const ANALYSIS_STATES = /** @type {const} */ (['queued', 'running', 'completed', 'failed']);
/** @typedef {(typeof ANALYSIS_STATES)[number]} AnalysisState */
export const ANALYSIS_STAGES = /** @type {const} */ ([
  'queued',
  'parsing',
  'comparing',
  'gating',
  'persisting',
  'done',
]);

export const ERROR_CODES = /** @type {const} */ ([
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
]);
/** @typedef {(typeof ERROR_CODES)[number]} ErrorCode */

export const LIMITS = /** @type {const} */ ({
  maxSpecBytes: 2 * 1024 * 1024,
  maxProjectsPerWorkspace: 100,
  maxVersionsPerProject: 300,
  maxConsumersPerProject: 200,
  maxDependenciesPerConsumer: 300,
  maxWorkspacesPerUser: 20,
  findingsPageSizeMax: 200,
});

export const CSRF_HEADER = 'x-csrf-token';
