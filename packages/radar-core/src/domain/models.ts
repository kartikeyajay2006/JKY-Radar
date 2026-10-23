import type { Diagnostic, Protocol, SourceRef } from './types.js';

/* ------------------------------------------------------------------ */
/* Normalised JSON Schema (dialect-neutral, cycle-safe object graph)   */
/* ------------------------------------------------------------------ */

export type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface SchemaConstraints {
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
}

export interface NSchema {
  /** Stable identity (document pointer of the definition) used for cycle detection. */
  id: string;
  src?: SourceRef;
  /** null = unconstrained ("any"). */
  types: JsonType[] | null;
  properties: Record<string, NSchema>;
  required: string[];
  /** true/undefined = allowed, false = forbidden, NSchema = constrained. */
  additionalProperties?: boolean | NSchema;
  items?: NSchema;
  enum?: unknown[];
  const?: { value: unknown };
  constraints: SchemaConstraints;
  pattern?: string;
  format?: string;
  readOnly?: boolean;
  writeOnly?: boolean;
  deprecated?: boolean;
  default?: { value: unknown };
  description?: string;
  title?: string;
  /** Composition keywords that are compared structurally only (never assumed equivalent). */
  combinators: {
    allOf?: NSchema[];
    oneOf?: NSchema[];
    anyOf?: NSchema[];
    not?: NSchema;
    conditional?: { if?: NSchema; then?: NSchema; else?: NSchema };
  };
  /** Keywords present but not semantically modelled, with their raw canonical JSON for change detection. */
  unsupported: Record<string, string>;
  /** Set when a $ref could not be resolved locally (e.g. remote URL). */
  unresolvedRef?: string;
  /** Whether allOf members were safely merged into this node. */
  mergedAllOf?: boolean;
}

/* ------------------------------------------------------------------ */
/* HTTP canonical model (OpenAPI / Swagger 2 / Manual / Postman proj.) */
/* ------------------------------------------------------------------ */

export type HttpParamLocation = 'path' | 'query' | 'header' | 'cookie';

export interface HttpParameter {
  name: string;
  in: HttpParamLocation;
  required: boolean;
  deprecated: boolean;
  schema?: NSchema;
  style?: string;
  explode?: boolean;
  description?: string;
  src?: SourceRef;
}

export interface HttpMediaType {
  schema?: NSchema;
  src?: SourceRef;
}

export interface HttpRequestBody {
  required: boolean;
  description?: string;
  content: Record<string, HttpMediaType>;
  src?: SourceRef;
}

export interface HttpResponseHeader {
  required: boolean;
  schema?: NSchema;
  src?: SourceRef;
}

export interface HttpResponse {
  status: string;
  description?: string;
  content: Record<string, HttpMediaType>;
  headers: Record<string, HttpResponseHeader>;
  src?: SourceRef;
}

/** One alternative of a security requirement: scheme name -> required scopes. Empty object = anonymous allowed. */
export type SecurityRequirement = Record<string, string[]>;

export interface SecuritySchemeDef {
  type: string;
  in?: string;
  name?: string;
  scheme?: string;
  bearerFormat?: string;
  flows?: string[];
  openIdConnectUrl?: string;
  src?: SourceRef;
}

export interface HttpOperation {
  /** Matching key: "GET /orders/{}" (path params normalised). */
  key: string;
  /** Display key with original template: "GET /orders/{id}". */
  displayKey: string;
  method: string;
  path: string;
  normalizedPath: string;
  operationId?: string;
  summary?: string;
  description?: string;
  deprecated: boolean;
  parameters: HttpParameter[];
  requestBody?: HttpRequestBody;
  responses: Record<string, HttpResponse>;
  /** Effective security; null when the contract format cannot express it. */
  security: SecurityRequirement[] | null;
  src?: SourceRef;
}

export interface HttpContractModel {
  kind: 'http';
  info: { title?: string; version?: string; description?: string };
  servers: Array<{ url: string; src?: SourceRef }>;
  operations: HttpOperation[];
  securitySchemes: Record<string, SecuritySchemeDef>;
  /** How authoritative the model is. */
  evidence: 'contract' | 'manual' | 'collection';
}

/* ------------------------------------------------------------------ */
/* JSON Schema document model                                          */
/* ------------------------------------------------------------------ */

export interface JsonSchemaContractModel {
  kind: 'json-schema';
  dialect: string;
  root: NSchema;
  title?: string;
}

/* ------------------------------------------------------------------ */
/* Parsed contract envelope                                            */
/* ------------------------------------------------------------------ */

export interface ParsedContract<M = unknown> {
  protocol: Protocol;
  formatVersion: string;
  title?: string;
  version?: string;
  model: M;
  diagnostics: Diagnostic[];
  /** Constructs present in the document that are not semantically compared. */
  ignoredConstructs: string[];
  stats: Record<string, number>;
}
