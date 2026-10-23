/** @import { Diagnostic, Protocol, SourceRef } from './types.js' */

/* ------------------------------------------------------------------ */
/* Normalised JSON Schema (dialect-neutral, cycle-safe object graph)   */
/* ------------------------------------------------------------------ */

/** @typedef {'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null'} JsonType */

/**
 * @typedef {Object} SchemaConstraints
 * @property {number} [minLength]
 * @property {number} [maxLength]
 * @property {number} [minimum]
 * @property {number} [maximum]
 * @property {number} [exclusiveMinimum]
 * @property {number} [exclusiveMaximum]
 * @property {number} [multipleOf]
 * @property {number} [minItems]
 * @property {number} [maxItems]
 * @property {boolean} [uniqueItems]
 * @property {number} [minProperties]
 * @property {number} [maxProperties]
 */

/**
 * @typedef {Object} NSchema
 * @property {string} id - Stable identity (document pointer of the definition) used for cycle detection.
 * @property {SourceRef} [src]
 * @property {JsonType[] | null} types - null = unconstrained ("any").
 * @property {Record<string, NSchema>} properties
 * @property {string[]} required
 * @property {boolean | NSchema} [additionalProperties] - true/undefined = allowed, false = forbidden, NSchema = constrained.
 * @property {NSchema} [items]
 * @property {unknown[]} [enum]
 * @property {{ value: unknown }} [const]
 * @property {SchemaConstraints} constraints
 * @property {string} [pattern]
 * @property {string} [format]
 * @property {boolean} [readOnly]
 * @property {boolean} [writeOnly]
 * @property {boolean} [deprecated]
 * @property {{ value: unknown }} [default]
 * @property {string} [description]
 * @property {string} [title]
 * @property {{ allOf?: NSchema[]; oneOf?: NSchema[]; anyOf?: NSchema[]; not?: NSchema; conditional?: { if?: NSchema; then?: NSchema; else?: NSchema }; }} combinators - Composition keywords that are compared structurally only (never assumed equivalent).
 * @property {Record<string, string>} unsupported - Keywords present but not semantically modelled, with their raw canonical JSON for change detection.
 * @property {string} [unresolvedRef] - Set when a $ref could not be resolved locally (e.g. remote URL).
 * @property {boolean} [mergedAllOf] - Whether allOf members were safely merged into this node.
 */

/* ------------------------------------------------------------------ */
/* HTTP canonical model (OpenAPI / Swagger 2 / Manual / Postman proj.) */
/* ------------------------------------------------------------------ */

/** @typedef {'path' | 'query' | 'header' | 'cookie'} HttpParamLocation */

/**
 * @typedef {Object} HttpParameter
 * @property {string} name
 * @property {HttpParamLocation} in
 * @property {boolean} required
 * @property {boolean} deprecated
 * @property {NSchema} [schema]
 * @property {string} [style]
 * @property {boolean} [explode]
 * @property {string} [description]
 * @property {SourceRef} [src]
 */

/**
 * @typedef {Object} HttpMediaType
 * @property {NSchema} [schema]
 * @property {SourceRef} [src]
 */

/**
 * @typedef {Object} HttpRequestBody
 * @property {boolean} required
 * @property {string} [description]
 * @property {Record<string, HttpMediaType>} content
 * @property {SourceRef} [src]
 */

/**
 * @typedef {Object} HttpResponseHeader
 * @property {boolean} required
 * @property {NSchema} [schema]
 * @property {SourceRef} [src]
 */

/**
 * @typedef {Object} HttpResponse
 * @property {string} status
 * @property {string} [description]
 * @property {Record<string, HttpMediaType>} content
 * @property {Record<string, HttpResponseHeader>} headers
 * @property {SourceRef} [src]
 */

/**
 *  One alternative of a security requirement: scheme name -> required scopes. Empty object = anonymous allowed.
 * @typedef {Record<string, string[]>} SecurityRequirement
 */

/**
 * @typedef {Object} SecuritySchemeDef
 * @property {string} type
 * @property {string} [in]
 * @property {string} [name]
 * @property {string} [scheme]
 * @property {string} [bearerFormat]
 * @property {string[]} [flows]
 * @property {string} [openIdConnectUrl]
 * @property {SourceRef} [src]
 */

/**
 * @typedef {Object} HttpOperation
 * @property {string} key - Matching key: "GET /orders/{}" (path params normalised).
 * @property {string} displayKey - Display key with original template: "GET /orders/{id}".
 * @property {string} method
 * @property {string} path
 * @property {string} normalizedPath
 * @property {string} [operationId]
 * @property {string} [summary]
 * @property {string} [description]
 * @property {boolean} deprecated
 * @property {HttpParameter[]} parameters
 * @property {HttpRequestBody} [requestBody]
 * @property {Record<string, HttpResponse>} responses
 * @property {SecurityRequirement[] | null} security - Effective security; null when the contract format cannot express it.
 * @property {SourceRef} [src]
 */

/**
 * @typedef {Object} HttpContractModel
 * @property {'http'} kind
 * @property {{ title?: string; version?: string; description?: string }} info
 * @property {Array<{ url: string; src?: SourceRef }>} servers
 * @property {HttpOperation[]} operations
 * @property {Record<string, SecuritySchemeDef>} securitySchemes
 * @property {'contract' | 'manual' | 'collection'} evidence - How authoritative the model is.
 */

/* ------------------------------------------------------------------ */
/* JSON Schema document model                                          */
/* ------------------------------------------------------------------ */

/**
 * @typedef {Object} JsonSchemaContractModel
 * @property {'json-schema'} kind
 * @property {string} dialect
 * @property {NSchema} root
 * @property {string} [title]
 */

/* ------------------------------------------------------------------ */
/* Parsed contract envelope                                            */
/* ------------------------------------------------------------------ */

/**
 * @template [M=unknown]
 * @typedef {Object} ParsedContract
 * @property {Protocol} protocol
 * @property {string} formatVersion
 * @property {string} [title]
 * @property {string} [version]
 * @property {M} model
 * @property {Diagnostic[]} diagnostics
 * @property {string[]} ignoredConstructs - Constructs present in the document that are not semantically compared.
 * @property {Record<string, number>} stats
 */

export {};
