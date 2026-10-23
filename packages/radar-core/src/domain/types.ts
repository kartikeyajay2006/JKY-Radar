/**
 * JKY-Radar canonical domain model.
 * Protocol-aware discriminated unions: each protocol family keeps its own semantics
 * instead of being flattened into one lossy "API" shape.
 */

export const PROTOCOLS = [
  'openapi',
  'swagger2',
  'postman2',
  'postman3',
  'graphql',
  'grpc',
  'asyncapi',
  'json-schema',
  'manual-rest',
] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export type ProtocolFamily = 'http' | 'graphql' | 'grpc' | 'async' | 'json-schema';

export const PROTOCOL_FAMILY: Record<Protocol, ProtocolFamily> = {
  openapi: 'http',
  swagger2: 'http',
  postman2: 'http',
  postman3: 'http',
  'manual-rest': 'http',
  graphql: 'graphql',
  grpc: 'grpc',
  asyncapi: 'async',
  'json-schema': 'json-schema',
};

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  openapi: 'OpenAPI 3.x',
  swagger2: 'Swagger 2.0',
  postman2: 'Postman Collection v2.1',
  postman3: 'Postman Collection v3',
  graphql: 'GraphQL',
  grpc: 'Protocol Buffers / gRPC',
  asyncapi: 'AsyncAPI',
  'json-schema': 'JSON Schema',
  'manual-rest': 'Manual REST contract',
};

export const SEVERITIES = [
  'breaking',
  'potentially_breaking',
  'needs_review',
  'non_breaking',
  'informational',
] as const;
export type FindingSeverity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<FindingSeverity, number> = {
  breaking: 0,
  potentially_breaking: 1,
  needs_review: 2,
  non_breaking: 3,
  informational: 4,
};

export const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  breaking: 'Breaking',
  potentially_breaking: 'Potentially breaking',
  needs_review: 'Needs review',
  non_breaking: 'Non-breaking',
  informational: 'Informational',
};

export type GateDecision = 'pass' | 'warn' | 'block' | 'inconclusive';
export type CoverageLevel = 'full' | 'partial' | 'unknown';
export type EvidenceLevel = 'contract_proven' | 'heuristic' | 'unknown';
export type SupportStatus = 'supported' | 'partial' | 'experimental' | 'unsupported';
export type ComparisonMode = 'same_protocol' | 'cross_format_http';
export type SchemaPolarity = 'request' | 'response';

export interface SourceRef {
  file?: 'baseline' | 'candidate' | string;
  jsonPointer?: string;
  line?: number;
  column?: number;
}

export interface Finding {
  ruleId: string;
  severity: FindingSeverity;
  protocol: Protocol;
  title: string;
  /** What changed — specific to this occurrence. */
  explanation: string;
  /** Why it is risky — from the rule definition. */
  impact: string;
  /** How to fix or mitigate. */
  recommendation: string;
  /** What JKY-Radar cannot know from the contracts alone. */
  unknowns?: string;
  /** Stable logical location, e.g. "GET /orders/{id} › response 200 › body.email". */
  logicalPath: string;
  /** Operation/type/channel key used for consumer impact joins. */
  entityKey?: string;
  before?: unknown;
  after?: unknown;
  baselineSource?: SourceRef;
  candidateSource?: SourceRef;
  evidenceLevel: EvidenceLevel;
  fingerprint: string;
  tags: string[];
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  source?: SourceRef;
}

export interface CoverageReport {
  level: CoverageLevel;
  /** Rules registered for this protocol. */
  supportedRules: number;
  /** Rules for this protocol that have positive + negative tests in the repository. */
  testedRules: number;
  /** Constructs present in the inputs that were not semantically compared. */
  ignoredConstructs: string[];
  /** Plain-language reasons the level is not "full". */
  reasons: string[];
}

export interface GateResult {
  decision: GateDecision;
  policyId: string;
  policyVersion: string;
  reasons: string[];
  counts: Record<FindingSeverity, number>;
  /** Findings whose effective severity was changed by an explicit policy override. */
  overridden: Array<{
    fingerprint: string;
    ruleId: string;
    from: FindingSeverity;
    to: FindingSeverity;
    justification: string;
  }>;
}

export interface ContractSummary {
  protocol: Protocol;
  formatVersion: string;
  title?: string;
  version?: string;
  stats: Record<string, number>;
}

export interface AnalysisResult {
  schemaVersion: '1.0';
  protocol: Protocol;
  comparisonMode: ComparisonMode;
  baseline: ContractSummary;
  candidate: ContractSummary;
  findings: Finding[];
  uncoveredConstructs: string[];
  parserWarnings: Diagnostic[];
  coverage: CoverageReport;
  gate: GateResult;
  engineVersion: string;
  ruleRegistryVersion: string;
  adapterVersion: string;
  policyVersion: string;
  options: AnalysisOptions;
}

export interface AnalysisOptions {
  /** JSON Schema comparisons: is the schema describing data clients SEND (request) or RECEIVE (response)? */
  jsonSchemaPolarity?: SchemaPolarity;
  /** Explicit opt-in for comparing e.g. Swagger 2.0 against OpenAPI 3.x through the canonical HTTP model. */
  allowCrossFormat?: boolean;
  /** Treat documentation-only changes as findings (informational). Default true. */
  includeInformational?: boolean;
  /** User-supplied rename mapping for HTTP operations: baseline key -> candidate key. */
  operationAliases?: Record<string, string>;
}
