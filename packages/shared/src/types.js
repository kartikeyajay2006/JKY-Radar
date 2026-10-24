/** @import { AnalysisOptions, ComparisonMode, ContractSummary, CoverageReport, Diagnostic, Finding, FindingSeverity, GateResult, ImpactReport, Protocol } from '@jky/radar-core' */
/** @import { AnalysisState, ErrorCode, ReviewDecision, Role } from './constants.js' */

/**
 * @typedef {Object} ApiErrorBody
 * @property {{ code: ErrorCode | string; message: string; details?: unknown; requestId: string }} error
 */
/**
 * @template T
 * @template [M=undefined]
 * @typedef {Object} ApiData
 * @property {T} data
 * @property {M} [meta]
 */
/**
 * @typedef {Object} PageMeta
 * @property {number} page
 * @property {number} pageSize
 * @property {number} total
 * @property {number} totalPages
 */

/**
 * @typedef {Object} UserDTO
 * @property {string} id
 * @property {string} email
 * @property {string} name
 * @property {{ theme: 'system' | 'light' | 'dark' }} preferences
 * @property {string} createdAt
 */
/**
 * @typedef {Object} SessionDTO
 * @property {UserDTO} user
 * @property {string} csrfToken
 */

/**
 * @typedef {Object} WorkspaceDTO
 * @property {string} id
 * @property {string} name
 * @property {string} slug
 * @property {Role} role
 * @property {boolean} isDemo
 * @property {string} createdAt
 * @property {{ projects: number; members: number }} [counts]
 */
/**
 * @typedef {Object} MemberDTO
 * @property {string} id
 * @property {string} userId
 * @property {string} email
 * @property {string} name
 * @property {Role} role
 * @property {'active' | 'invited'} status
 * @property {string} createdAt
 */
/**
 * @typedef {Object} InvitationDTO
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} workspaceName
 * @property {Role} role
 * @property {string} invitedBy
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ProjectDTO
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name
 * @property {string} slug
 * @property {string} description
 * @property {Protocol} protocol
 * @property {number} versionCount
 * @property {{ id: string; label: string; createdAt: string } | null} latestVersion
 * @property {{ id: string; gate: GateResult['decision'] | null; state: AnalysisState; createdAt: string; } | null} latestAnalysis
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {Object} VersionDTO
 * @property {string} id
 * @property {string} projectId
 * @property {string} label
 * @property {Protocol} protocol
 * @property {string} formatVersion
 * @property {string} [title]
 * @property {string} [apiVersion]
 * @property {string} [fileName]
 * @property {number} size
 * @property {string} rawHash
 * @property {string} normalizedHash
 * @property {Record<string, number>} stats
 * @property {Diagnostic[]} diagnostics
 * @property {string[]} ignoredConstructs
 * @property {Array<{ line: number; reason: string }>} redactions
 * @property {{ confidence: string; reasons: string[]; overridden: boolean }} detection
 * @property {string} [notes]
 * @property {{ id: string; name: string }} uploadedBy
 * @property {string} createdAt
 */

/**
 * @typedef {Object} AnalysisSummaryDTO
 * @property {string} id
 * @property {string} projectId
 * @property {string} [projectName]
 * @property {Protocol} protocol
 * @property {AnalysisState} state
 * @property {string} stage
 * @property {GateResult['decision'] | null} gate
 * @property {Record<FindingSeverity, number> | null} counts
 * @property {CoverageReport['level'] | null} coverageLevel
 * @property {{ id: string; label: string }} baseline
 * @property {{ id: string; label: string }} candidate
 * @property {'pending' | 'approved' | 'rejected' | 'changes_requested' | 'not_required'} reviewStatus
 * @property {{ id: string; name: string }} createdBy
 * @property {string} createdAt
 * @property {string} [completedAt]
 * @property {boolean} isPublicDemo
 */

/**
 * @typedef {AnalysisSummaryDTO & { workspaceId: string; comparisonMode: ComparisonMode | null; options: AnalysisOptions; gateResult: GateResult | null; coverage: CoverageReport | null; baselineSummary: ContractSummary | null; candidateSummary: ContractSummary | null; baselineVersion: Pick<VersionDTO, 'id' | 'label' | 'rawHash' | 'fileName' | 'formatVersion' | 'createdAt'>; candidateVersion: Pick<VersionDTO, 'id' | 'label' | 'rawHash' | 'fileName' | 'formatVersion' | 'createdAt'>; uncoveredConstructs: string[]; parserWarnings: Diagnostic[]; versions: { engine: string; rules: string; adapter: string; policy: string } | null; policy: { id: string; name: string; revision: number } | null; inputHash: string; error?: { code: string; message: string; details?: unknown }; timings: { queuedAt: string; startedAt?: string; completedAt?: string; durationMs?: number }; cached?: boolean }} AnalysisDTO
 */

/** @typedef {Finding & { id: string; index: number }} FindingDTO */

/**
 * @typedef {Object} ConsumerDTO
 * @property {string} id
 * @property {string} projectId
 * @property {string} name
 * @property {string} owner
 * @property {string} team
 * @property {string} contact
 * @property {'low' | 'medium' | 'high' | 'critical'} criticality
 * @property {string} description
 * @property {Array<{ id: string; operationKey: string; normalizedKey: string; evidenceSource: string; notes: string; lastConfirmedAt: string; }>} dependencies
 * @property {string} createdAt
 */

/**
 * @typedef {Object} PolicyDTO
 * @property {string} id
 * @property {string} projectId
 * @property {string} name
 * @property {number} revision
 * @property {Record<FindingSeverity, 'block' | 'warn' | 'ignore'>} actions
 * @property {'inconclusive' | 'warn'} onCoverageGap
 * @property {'warn' | 'pass'} onPartialCoverage
 * @property {Array<{ ruleId: string; severity: FindingSeverity; justification: string; addedBy?: string; addedAt?: string; }>} ruleOverrides
 * @property {boolean} requireReview
 * @property {boolean} forbidSelfApproval
 * @property {number} minApprovals
 * @property {string[]} protectedEnvironments
 * @property {string} version
 * @property {{ id: string; name: string } | null} updatedBy
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ReviewDTO
 * @property {string} id
 * @property {string} analysisId
 * @property {{ id: string; name: string }} reviewer
 * @property {ReviewDecision} decision
 * @property {string} rationale
 * @property {boolean} overrideBlock
 * @property {string} createdAt
 */

/**
 * @typedef {Object} NotificationDTO
 * @property {string} id
 * @property {string} kind
 * @property {string} title
 * @property {string} body
 * @property {string | null} link
 * @property {string | null} workspaceId
 * @property {string | null} readAt
 * @property {string} createdAt
 */

/**
 * @typedef {Object} AuditEventDTO
 * @property {string} id
 * @property {{ id: string; name: string } | null} actor
 * @property {string} action
 * @property {string} resourceType
 * @property {string | null} resourceId
 * @property {Record<string, unknown>} metadata
 * @property {string} [requestId]
 * @property {string} createdAt
 */

/**
 * @typedef {Object} OverviewDTO
 * @property {{ projects: number; versions: number; analyses: number; consumers: number; blocked: number; pendingReviews: number; }} counts
 * @property {Record<FindingSeverity, number>} severityTotals
 * @property {Record<'pass' | 'warn' | 'block' | 'inconclusive', number>} gateTotals
 * @property {Array<{ date: string; analyses: number; blocked: number }>} timeline
 * @property {Array<{ entityKey: string; count: number; worst: FindingSeverity }>} topEntities
 * @property {Array<{ consumerId: string; name: string; criticality: string; impactedAnalyses: number }>} topConsumers
 * @property {{ reviewed: number; total: number }} reviewCompletion
 * @property {AnalysisSummaryDTO[]} recentAnalyses
 */

/**
 * A CI token as listed in the UI. The secret itself is only returned once, on creation.
 * @typedef {Object} ApiTokenDTO
 * @property {string} id
 * @property {string} projectId
 * @property {string} name
 * @property {string} prefix
 * @property {{ id: string; name: string } | null} createdBy
 * @property {string} createdAt
 * @property {string} expiresAt
 * @property {string | null} lastUsedAt
 * @property {string | null} revokedAt
 * @property {'active' | 'expired' | 'revoked'} status
 */

/** @typedef {ImpactReport} ImpactDTO */

export {};
