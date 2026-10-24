import { z } from 'zod';
import { PROTOCOLS, SEVERITIES } from '@jky/radar-core';
import { CRITICALITIES, REVIEW_DECISIONS, ROLES } from './constants.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
export const idParam = z.object({ id: objectId });
export const objectIdSchema = objectId;

const email = z.string().trim().toLowerCase().email().max(254);
const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and at least one number');
const name = z.string().trim().min(1).max(120);

export const registerSchema = z.object({ email, password, name });
export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const updateMeSchema = z.object({
  name: name.optional(),
  preferences: z.object({ theme: z.enum(['system', 'light', 'dark']).optional() }).optional(),
});

export const createWorkspaceSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const updateWorkspaceSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const inviteSchema = z.object({ email, role: z.enum(ROLES).exclude(['OWNER']) });
export const updateMemberSchema = z.object({ role: z.enum(ROLES).exclude(['OWNER']) });

export const protocolSchema = z.enum(PROTOCOLS);
export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional().default(''),
  protocol: protocolSchema,
});
export const updateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(500).optional(),
});
export const listProjectsQuery = z.object({ search: z.string().trim().max(80).optional() });

export const createVersionSchema = z.object({
  label: z.string().trim().min(1).max(60),
  content: z.string().min(1, 'Contract content is empty'),
  fileName: z
    .string()
    .trim()
    .max(200)
    .regex(/^[^/\\\0]+$/, 'File name must not contain path separators')
    .optional(),
  protocol: protocolSchema.optional(),
  notes: z.string().trim().max(500).optional(),
});

export const analysisOptionsSchema = z
  .object({
    jsonSchemaPolarity: z.enum(['request', 'response']).optional(),
    allowCrossFormat: z.boolean().optional(),
    includeInformational: z.boolean().optional(),
    operationAliases: z.record(z.string().max(300), z.string().max(300)).optional(),
  })
  .strict();
export const createAnalysisSchema = z.object({
  baselineId: objectId,
  candidateId: objectId,
  options: analysisOptionsSchema.optional().default({}),
});

/* ------------------------------------------------------------ CI tokens */
export const API_TOKEN_PREFIX = 'jkyr_';
export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  expiresInDays: z.number().int().min(1).max(365).default(90),
});

/** Body of POST /ci/check: upload the candidate and compare it with a baseline in one call. */
export const ciCheckSchema = z
  .object({
    candidate: createVersionSchema.omit({ protocol: true }),
    /** Version id or label to compare against. Defaults to the newest version uploaded before this one. */
    baseline: z.string().trim().min(1).max(60).optional(),
    options: analysisOptionsSchema.optional().default({}),
    /** Seconds to wait for the verdict before answering 202 with a poll URL. */
    wait: z.number().int().min(0).max(120).default(60),
  })
  .strict();

export const findingsQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  severity: z
    .union([z.enum(SEVERITIES), z.array(z.enum(SEVERITIES))])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  ruleId: z.string().trim().max(80).optional(),
  entity: z.string().trim().max(300).optional(),
  search: z.string().trim().max(120).optional(),
});

export const reportQuery = z.object({ format: z.enum(['json', 'md', 'pdf']).default('json') });

export const createConsumerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  owner: z.string().trim().max(120).optional().default(''),
  team: z.string().trim().max(120).optional().default(''),
  contact: z.string().trim().max(200).optional().default(''),
  criticality: z.enum(CRITICALITIES),
  description: z.string().trim().max(500).optional().default(''),
});
export const updateConsumerSchema = createConsumerSchema.partial();
export const addDependencySchema = z.object({
  operationKey: z.string().trim().min(1).max(300),
  evidenceSource: z
    .enum(['manual', 'documentation', 'code-search', 'traffic-sample', 'owner-confirmed'])
    .default('manual'),
  notes: z.string().trim().max(300).optional().default(''),
});

const severityAction = z.enum(['block', 'warn', 'ignore']);
export const updatePolicySchema = z.object({
  name: z.string().trim().min(2).max(80),
  actions: z.object({
    breaking: severityAction,
    potentially_breaking: severityAction,
    needs_review: severityAction,
    non_breaking: severityAction,
    informational: severityAction,
  }),
  onCoverageGap: z.enum(['inconclusive', 'warn']),
  onPartialCoverage: z.enum(['warn', 'pass']),
  ruleOverrides: z
    .array(
      z.object({
        ruleId: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
        severity: z.enum(SEVERITIES),
        justification: z.string().trim().min(10, 'Explain why (at least 10 characters)').max(500),
      }),
    )
    .max(50),
  requireReview: z.boolean(),
  forbidSelfApproval: z.boolean(),
  minApprovals: z.number().int().min(0).max(5),
  protectedEnvironments: z.array(z.string().trim().min(1).max(40)).max(10),
});

export const createReviewSchema = z
  .object({
    decision: z.enum(REVIEW_DECISIONS),
    rationale: z.string().trim().min(3, 'Add a short rationale').max(2000),
    overrideBlock: z.boolean().optional().default(false),
  })
  .refine((v) => !v.overrideBlock || (v.decision === 'approve' && v.rationale.length >= 20), {
    message: 'Overriding a blocked gate requires an approval with a rationale of at least 20 characters',
    path: ['rationale'],
  });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** @typedef {z.infer<typeof registerSchema>} RegisterInput */
/** @typedef {z.infer<typeof loginSchema>} LoginInput */
/** @typedef {z.input<typeof createProjectSchema>} CreateProjectInput */
/** @typedef {z.infer<typeof createVersionSchema>} CreateVersionInput */
/** @typedef {z.input<typeof createAnalysisSchema>} CreateAnalysisInput */
/** @typedef {z.input<typeof findingsQuery>} FindingsQuery */
/** @typedef {z.input<typeof createTokenSchema>} CreateTokenInput */
/** @typedef {z.input<typeof ciCheckSchema>} CiCheckInput */
/** @typedef {z.input<typeof createConsumerSchema>} CreateConsumerInput */
/** @typedef {z.input<typeof addDependencySchema>} AddDependencyInput */
/** @typedef {z.infer<typeof updatePolicySchema>} UpdatePolicyInput */
/** @typedef {z.input<typeof createReviewSchema>} CreateReviewInput */
