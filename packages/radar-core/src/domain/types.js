/**
 * JKY-Radar canonical domain model.
 * Protocol-aware discriminated unions: each protocol family keeps its own semantics
 * instead of being flattened into one lossy "API" shape.
 */

export const PROTOCOLS = /** @type {const} */ ([
  'openapi',
  'swagger2',
  'postman2',
  'postman3',
  'graphql',
  'grpc',
  'asyncapi',
  'json-schema',
  'manual-rest',
]);
/** @typedef {(typeof PROTOCOLS)[number]} Protocol */

/** @typedef {'http' | 'graphql' | 'grpc' | 'async' | 'json-schema'} ProtocolFamily */

/** @type {Record<Protocol, ProtocolFamily>} */
export const PROTOCOL_FAMILY = {
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

/** @type {Record<Protocol, string>} */
export const PROTOCOL_LABEL = {
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

export const SEVERITIES = /** @type {const} */ ([
  'breaking',
  'potentially_breaking',
  'needs_review',
  'non_breaking',
  'informational',
]);
/** @typedef {(typeof SEVERITIES)[number]} FindingSeverity */

/** @type {Record<FindingSeverity, number>} */
export const SEVERITY_RANK = {
  breaking: 0,
  potentially_breaking: 1,
  needs_review: 2,
  non_breaking: 3,
  informational: 4,
};

/** @type {Record<FindingSeverity, string>} */
export const SEVERITY_LABEL = {
  breaking: 'Breaking',
  potentially_breaking: 'Potentially breaking',
  needs_review: 'Needs review',
  non_breaking: 'Non-breaking',
  informational: 'Informational',
};

/** @typedef {'pass' | 'warn' | 'block' | 'inconclusive'} GateDecision */
/** @typedef {'full' | 'partial' | 'unknown'} CoverageLevel */
/** @typedef {'contract_proven' | 'heuristic' | 'unknown'} EvidenceLevel */
/** @typedef {'supported' | 'partial' | 'experimental' | 'unsupported'} SupportStatus */
/** @typedef {'same_protocol' | 'cross_format_http'} ComparisonMode */
/** @typedef {'request' | 'response'} SchemaPolarity */

/**
 * @typedef {Object} SourceRef
 * @property {'baseline' | 'candidate' | string} [file]
 * @property {string} [jsonPointer]
 * @property {number} [line]
 * @property {number} [column]
 */

/**
 * @typedef {Object} Finding
 * @property {string} ruleId
 * @property {FindingSeverity} severity
 * @property {Protocol} protocol
 * @property {string} title
 * @property {string} explanation - What changed — specific to this occurrence.
 * @property {string} impact - Why it is risky — from the rule definition.
 * @property {string} recommendation - How to fix or mitigate.
 * @property {string} [unknowns] - What JKY-Radar cannot know from the contracts alone.
 * @property {string} logicalPath - Stable logical location, e.g. "GET /orders/{id} › response 200 › body.email".
 * @property {string} [entityKey] - Operation/type/channel key used for consumer impact joins.
 * @property {unknown} [before]
 * @property {unknown} [after]
 * @property {SourceRef} [baselineSource]
 * @property {SourceRef} [candidateSource]
 * @property {EvidenceLevel} evidenceLevel
 * @property {string} fingerprint
 * @property {string[]} tags
 */

/**
 * @typedef {Object} Diagnostic
 * @property {'error' | 'warning' | 'info'} severity
 * @property {string} code
 * @property {string} message
 * @property {SourceRef} [source]
 */

/**
 * @typedef {Object} CoverageReport
 * @property {CoverageLevel} level
 * @property {number} supportedRules - Rules registered for this protocol.
 * @property {number} testedRules - Rules for this protocol that have positive + negative tests in the repository.
 * @property {string[]} ignoredConstructs - Constructs present in the inputs that were not semantically compared.
 * @property {string[]} reasons - Plain-language reasons the level is not "full".
 */

/**
 * @typedef {Object} GateResult
 * @property {GateDecision} decision
 * @property {string} policyId
 * @property {string} policyVersion
 * @property {string[]} reasons
 * @property {Record<FindingSeverity, number>} counts
 * @property {Array<{ fingerprint: string; ruleId: string; from: FindingSeverity; to: FindingSeverity; justification: string; }>} overridden - Findings whose effective severity was changed by an explicit policy override.
 */

/**
 * @typedef {Object} ContractSummary
 * @property {Protocol} protocol
 * @property {string} formatVersion
 * @property {string} [title]
 * @property {string} [version]
 * @property {Record<string, number>} stats
 */

/**
 * @typedef {Object} AnalysisResult
 * @property {'1.0'} schemaVersion
 * @property {Protocol} protocol
 * @property {ComparisonMode} comparisonMode
 * @property {ContractSummary} baseline
 * @property {ContractSummary} candidate
 * @property {Finding[]} findings
 * @property {string[]} uncoveredConstructs
 * @property {Diagnostic[]} parserWarnings
 * @property {CoverageReport} coverage
 * @property {GateResult} gate
 * @property {string} engineVersion
 * @property {string} ruleRegistryVersion
 * @property {string} adapterVersion
 * @property {string} policyVersion
 * @property {AnalysisOptions} options
 */

/**
 * @typedef {Object} AnalysisOptions
 * @property {SchemaPolarity} [jsonSchemaPolarity] - JSON Schema comparisons: is the schema describing data clients SEND (request) or RECEIVE (response)?
 * @property {boolean} [allowCrossFormat] - Explicit opt-in for comparing e.g. Swagger 2.0 against OpenAPI 3.x through the canonical HTTP model.
 * @property {boolean} [includeInformational] - Treat documentation-only changes as findings (informational). Default true.
 * @property {Record<string, string>} [operationAliases] - User-supplied rename mapping for HTTP operations: baseline key -> candidate key.
 */
