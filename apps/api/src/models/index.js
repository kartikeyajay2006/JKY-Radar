import mongoose, { Schema } from 'mongoose';
import { CRITICALITIES, REVIEW_DECISIONS, ROLES, ANALYSIS_STATES } from '@jky/shared';
import { PROTOCOLS, SEVERITIES } from '@jky/radar-core';

/** @import { InferSchemaType, Types } from 'mongoose' */

const { model } = mongoose;
const opts = /** @type {const} */ ({ timestamps: true, versionKey: false });
const Mixed = Schema.Types.Mixed;
const ObjectId = Schema.Types.ObjectId;

/**
 * Reject any update to documents that must stay immutable (versions, findings, reviews, audit).
 * @param {Schema} schema
 * @param {string} name
 */
function immutable(schema, name) {
  /** @param {(err?: Error) => void} next */
  const deny = function (next) {
    next(new Error(`${name} records are immutable`));
  };
  for (const op of /** @type {const} */ ([
    'updateOne',
    'updateMany',
    'findOneAndUpdate',
    'replaceOne',
    'findOneAndReplace',
  ])) {
    schema.pre(op, deny);
  }
  schema.pre('save', function (next) {
    if (!this.isNew) return next(new Error(`${name} records are immutable`));
    next();
  });
}

/* ---------------------------------------------------------------- users */
const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    sessionVersion: { type: Number, default: 1 },
    preferences: { theme: { type: String, enum: ['system', 'light', 'dark'], default: 'system' } },
    isSystem: { type: Boolean, default: false },
    lastLoginAt: Date,
  },
  opts,
);
/** @typedef {InferSchemaType<typeof userSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date; }} UserDoc */
export const User = model('User', userSchema);

/* ---------------------------------------------------------------- sessions */
const sessionSchema = new Schema(
  {
    tokenHash: { type: String, required: true, unique: true },
    userId: { type: ObjectId, ref: 'User', required: true, index: true },
    csrfSalt: { type: String, required: true },
    sessionVersion: { type: Number, required: true },
    expiresAt: { type: Date, required: true },
    userAgent: { type: String, default: '' },
    lastSeenAt: { type: Date, default: () => new Date() },
  },
  opts,
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Session = model('Session', sessionSchema);

/* ---------------------------------------------------------------- workspaces & memberships */
const workspaceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    ownerId: { type: ObjectId, ref: 'User', required: true },
    isDemo: { type: Boolean, default: false },
    settings: { type: Mixed, default: {} },
  },
  opts,
);
export const Workspace = model('Workspace', workspaceSchema);

const membershipSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    userId: { type: ObjectId, ref: 'User', required: true },
    role: { type: String, enum: ROLES, required: true },
    status: { type: String, enum: ['active', 'invited'], default: 'active' },
    invitedBy: { type: ObjectId, ref: 'User' },
  },
  opts,
);
membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });
export const Membership = model('Membership', membershipSchema);

/* ---------------------------------------------------------------- projects */
const projectSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true },
    description: { type: String, default: '' },
    protocol: { type: String, enum: PROTOCOLS, required: true },
    visibility: { type: String, enum: ['workspace', 'public_demo'], default: 'workspace' },
    latestVersionId: { type: ObjectId, ref: 'SpecVersion' },
    latestAnalysisId: { type: ObjectId, ref: 'Analysis' },
    versionCount: { type: Number, default: 0 },
    createdBy: { type: ObjectId, ref: 'User', required: true },
  },
  opts,
);
projectSchema.index({ workspaceId: 1, slug: 1 }, { unique: true });
projectSchema.index({ workspaceId: 1, updatedAt: -1 });
export const Project = model('Project', projectSchema);

/* ---------------------------------------------------------------- spec files & versions (immutable) */
const specFileSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    content: { type: String, required: true },
    size: { type: Number, required: true },
  },
  opts,
);
specFileSchema.index({ workspaceId: 1, projectId: 1 });
immutable(specFileSchema, 'Spec file');
export const SpecFile = model('SpecFile', specFileSchema);

const diagnosticSchema = new Schema(
  { severity: String, code: String, message: String, source: { type: Mixed } },
  { _id: false },
);
const specVersionSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    label: { type: String, required: true, trim: true },
    protocol: { type: String, enum: PROTOCOLS, required: true },
    formatVersion: { type: String, required: true },
    title: String,
    apiVersion: String,
    fileName: String,
    notes: String,
    size: { type: Number, required: true },
    rawHash: { type: String, required: true },
    normalizedHash: { type: String, required: true },
    specFileId: { type: ObjectId, ref: 'SpecFile', required: true },
    stats: { type: Mixed, default: {} },
    diagnostics: { type: [diagnosticSchema], default: [] },
    ignoredConstructs: { type: [String], default: [] },
    redactions: { type: [{ line: Number, reason: String, _id: false }], default: [] },
    detection: { confidence: String, reasons: [String], overridden: Boolean },
    uploadedBy: { type: ObjectId, ref: 'User', required: true },
  },
  opts,
);
specVersionSchema.index({ projectId: 1, createdAt: -1 });
specVersionSchema.index({ projectId: 1, rawHash: 1 }, { unique: true });
specVersionSchema.index({ workspaceId: 1 });
immutable(specVersionSchema, 'Spec version');
export const SpecVersion = model('SpecVersion', specVersionSchema);

/* ---------------------------------------------------------------- policies (versioned) */
const policySchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true },
    revision: { type: Number, required: true },
    actions: { type: Mixed, required: true },
    onCoverageGap: { type: String, enum: ['inconclusive', 'warn'], required: true },
    onPartialCoverage: { type: String, enum: ['warn', 'pass'], required: true },
    ruleOverrides: {
      type: [
        {
          ruleId: String,
          severity: { type: String, enum: SEVERITIES },
          justification: String,
          addedBy: String,
          addedAt: Date,
          _id: false,
        },
      ],
      default: [],
    },
    requireReview: { type: Boolean, default: true },
    forbidSelfApproval: { type: Boolean, default: true },
    minApprovals: { type: Number, default: 1 },
    protectedEnvironments: { type: [String], default: ['production'] },
    updatedBy: { type: ObjectId, ref: 'User' },
  },
  opts,
);
policySchema.index({ projectId: 1, revision: -1 }, { unique: true });
immutable(policySchema, 'Policy revision');
export const Policy = model('Policy', policySchema);

/* ---------------------------------------------------------------- analyses & findings */
const analysisSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    baselineId: { type: ObjectId, ref: 'SpecVersion', required: true },
    candidateId: { type: ObjectId, ref: 'SpecVersion', required: true },
    protocol: { type: String, enum: PROTOCOLS, required: true },
    state: { type: String, enum: ANALYSIS_STATES, default: 'queued' },
    stage: { type: String, default: 'queued' },
    attempts: { type: Number, default: 0 },
    inputHash: { type: String, required: true },
    options: { type: Mixed, default: {} },
    policyId: { type: ObjectId, ref: 'Policy' },
    policyRevision: Number,
    policyName: String,
    policySnapshot: { type: Mixed },
    gate: { type: Mixed },
    coverage: { type: Mixed },
    counts: { type: Mixed },
    baselineSummary: { type: Mixed },
    candidateSummary: { type: Mixed },
    uncoveredConstructs: { type: [String], default: [] },
    parserWarnings: { type: Mixed, default: [] },
    comparisonMode: String,
    versions: { engine: String, rules: String, adapter: String, policy: String },
    error: { type: Mixed },
    findingCount: { type: Number, default: 0 },
    timings: { queuedAt: Date, startedAt: Date, completedAt: Date, durationMs: Number },
    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'changes_requested', 'not_required'],
      default: 'pending',
    },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    isPublicDemo: { type: Boolean, default: false },
  },
  opts,
);
analysisSchema.index({ projectId: 1, inputHash: 1 }, { unique: true });
analysisSchema.index({ projectId: 1, createdAt: -1 });
analysisSchema.index({ workspaceId: 1, createdAt: -1 });
analysisSchema.index({ state: 1 });
analysisSchema.index({ isPublicDemo: 1, createdAt: -1 });
export const Analysis = model('Analysis', analysisSchema);

const sourceRefSchema = { file: String, jsonPointer: String, line: Number, column: Number };
const findingSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    analysisId: { type: ObjectId, ref: 'Analysis', required: true },
    index: { type: Number, required: true },
    ruleId: { type: String, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    protocol: String,
    title: String,
    explanation: String,
    impact: String,
    recommendation: String,
    unknowns: String,
    logicalPath: String,
    entityKey: String,
    before: Mixed,
    after: Mixed,
    baselineSource: sourceRefSchema,
    candidateSource: sourceRefSchema,
    evidenceLevel: String,
    fingerprint: { type: String, required: true },
    tags: [String],
  },
  { versionKey: false, timestamps: { createdAt: true, updatedAt: false } },
);
findingSchema.index({ analysisId: 1, index: 1 });
findingSchema.index({ analysisId: 1, severity: 1 });
findingSchema.index({ analysisId: 1, ruleId: 1 });
findingSchema.index({ workspaceId: 1, entityKey: 1 });
immutable(findingSchema, 'Finding');
export const FindingModel = model('Finding', findingSchema);

/* ---------------------------------------------------------------- consumers */
const consumerSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, trim: true },
    owner: { type: String, default: '' },
    team: { type: String, default: '' },
    contact: { type: String, default: '' },
    criticality: { type: String, enum: CRITICALITIES, required: true },
    description: { type: String, default: '' },
    createdBy: { type: ObjectId, ref: 'User' },
  },
  opts,
);
consumerSchema.index({ projectId: 1, name: 1 }, { unique: true });
export const Consumer = model('Consumer', consumerSchema);

const dependencySchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    consumerId: { type: ObjectId, ref: 'Consumer', required: true },
    operationKey: { type: String, required: true },
    normalizedKey: { type: String, required: true },
    evidenceSource: { type: String, default: 'manual' },
    notes: { type: String, default: '' },
    lastConfirmedAt: { type: Date, default: () => new Date() },
  },
  opts,
);
dependencySchema.index({ consumerId: 1, normalizedKey: 1 }, { unique: true });
dependencySchema.index({ projectId: 1, normalizedKey: 1 });
export const ConsumerDependency = model('ConsumerDependency', dependencySchema);

/* ---------------------------------------------------------------- reviews (append-only) */
const reviewSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    analysisId: { type: ObjectId, ref: 'Analysis', required: true },
    reviewerId: { type: ObjectId, ref: 'User', required: true },
    decision: { type: String, enum: REVIEW_DECISIONS, required: true },
    rationale: { type: String, required: true },
    overrideBlock: { type: Boolean, default: false },
  },
  { versionKey: false, timestamps: { createdAt: true, updatedAt: false } },
);
reviewSchema.index({ analysisId: 1, createdAt: 1 });
immutable(reviewSchema, 'Review');
export const Review = model('Review', reviewSchema);

/* ---------------------------------------------------------------- notifications */
const notificationSchema = new Schema(
  {
    recipientId: { type: ObjectId, ref: 'User', required: true },
    workspaceId: { type: ObjectId, ref: 'Workspace' },
    kind: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    link: String,
    readAt: Date,
  },
  opts,
);
notificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });
export const Notification = model('Notification', notificationSchema);

/* ---------------------------------------------------------------- audit (append-only) */
const auditSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace' },
    actorId: { type: ObjectId, ref: 'User' },
    action: { type: String, required: true },
    resourceType: { type: String, required: true },
    resourceId: { type: String },
    metadata: { type: Mixed, default: {} },
    requestId: String,
  },
  { versionKey: false, timestamps: { createdAt: true, updatedAt: false } },
);
auditSchema.index({ workspaceId: 1, createdAt: -1 });
immutable(auditSchema, 'Audit event');
export const AuditEvent = model('AuditEvent', auditSchema);

/* ---------------------------------------------------------------- CI tokens */
// Project-scoped bearer tokens for pipelines. Only the SHA-256 of the secret is stored.
const apiTokenSchema = new Schema(
  {
    workspaceId: { type: ObjectId, ref: 'Workspace', required: true },
    projectId: { type: ObjectId, ref: 'Project', required: true },
    name: { type: String, required: true, trim: true },
    prefix: { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    createdBy: { type: ObjectId, ref: 'User', required: true },
    expiresAt: { type: Date, required: true },
    lastUsedAt: Date,
    revokedAt: Date,
    revokedBy: { type: ObjectId, ref: 'User' },
  },
  opts,
);
apiTokenSchema.index({ projectId: 1, createdAt: -1 });
/** @typedef {InferSchemaType<typeof apiTokenSchema> & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date; }} ApiTokenDoc */
export const ApiToken = model('ApiToken', apiTokenSchema);

/** @returns {Promise<void>} */
export async function ensureIndexes() {
  await Promise.all(
    [
      User,
      Session,
      Workspace,
      Membership,
      Project,
      SpecFile,
      SpecVersion,
      Policy,
      Analysis,
      FindingModel,
      Consumer,
      ConsumerDependency,
      Review,
      Notification,
      AuditEvent,
      ApiToken,
    ].map((m) => m.syncIndexes()),
  );
}
