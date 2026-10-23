import type { Protocol, SupportStatus } from '@jky/radar-core';
import { ruleRegistry } from '@jky/radar-core';

export interface Capability {
  id: string;
  protocol: Protocol | null;
  label: string;
  formats: string[];
  versions: string;
  status: SupportStatus;
  levels: { parse: SupportStatus; semanticDiff: SupportStatus; classification: SupportStatus };
  release: 'A' | 'B' | 'C';
  notes: string[];
}

export const CAPABILITIES: Capability[] = [
  {
    id: 'openapi-3.0',
    protocol: 'openapi',
    label: 'OpenAPI 3.0',
    formats: ['JSON', 'YAML'],
    versions: '3.0.x',
    status: 'supported',
    levels: { parse: 'supported', semanticDiff: 'supported', classification: 'supported' },
    release: 'A',
    notes: [
      'Local $ref with cycle detection; remote $ref never fetched.',
      'nullable normalised to type null.',
      'oneOf/anyOf/not/patterns are flagged for review, not decided.',
    ],
  },
  {
    id: 'openapi-3.1',
    protocol: 'openapi',
    label: 'OpenAPI 3.1',
    formats: ['JSON', 'YAML'],
    versions: '3.1.x',
    status: 'supported',
    levels: { parse: 'supported', semanticDiff: 'supported', classification: 'supported' },
    release: 'A',
    notes: [
      'JSON Schema 2020-12 dialect; type arrays and numeric exclusive bounds.',
      'webhooks are detected but not compared.',
    ],
  },
  {
    id: 'openapi-3.2',
    protocol: 'openapi',
    label: 'OpenAPI 3.2',
    formats: ['JSON', 'YAML'],
    versions: '3.2.x',
    status: 'partial',
    levels: { parse: 'partial', semanticDiff: 'partial', classification: 'partial' },
    release: 'B',
    notes: [
      'QUERY method and additionalOperations compared.',
      'itemSchema, $self, querystring parameters and tag hierarchy are not compared.',
    ],
  },
  {
    id: 'swagger-2.0',
    protocol: 'swagger2',
    label: 'Swagger / OpenAPI 2.0',
    formats: ['JSON', 'YAML'],
    versions: '2.0',
    status: 'supported',
    levels: { parse: 'supported', semanticDiff: 'supported', classification: 'supported' },
    release: 'A',
    notes: [
      'body/formData, consumes/produces and securityDefinitions projected to the canonical HTTP model.',
      'Lossy conversions (collectionFormat tsv, formData) are reported as diagnostics.',
    ],
  },
  {
    id: 'graphql-sdl',
    protocol: 'graphql',
    label: 'GraphQL SDL',
    formats: ['.graphql', '.gql'],
    versions: 'October 2021 spec (graphql-js 16)',
    status: 'supported',
    levels: { parse: 'supported', semanticDiff: 'supported', classification: 'supported' },
    release: 'A',
    notes: [
      'Coordinate-level rules plus graphql-js findBreakingChanges/findDangerousChanges safety net.',
      'Deprecation is reported separately from removal.',
    ],
  },
  {
    id: 'graphql-introspection',
    protocol: 'graphql',
    label: 'GraphQL introspection JSON',
    formats: ['JSON'],
    versions: 'introspection query result',
    status: 'supported',
    levels: { parse: 'supported', semanticDiff: 'supported', classification: 'supported' },
    release: 'A',
    notes: [
      'No source line locations (introspection carries none).',
      'Applied directives are not present in introspection.',
    ],
  },
  {
    id: 'postman-2.1',
    protocol: 'postman2',
    label: 'Postman Collection v2.1',
    formats: ['JSON'],
    versions: '2.1.0 (2.0.0 accepted)',
    status: 'partial',
    levels: { parse: 'supported', semanticDiff: 'partial', classification: 'partial' },
    release: 'A',
    notes: [
      'Requests, methods, paths, query/header keys, variables, body shape and auth type are compared.',
      'Collections are not authoritative contracts: severities are capped and response compatibility is unknown.',
      'Scripts are never executed; secrets are redacted before storage.',
    ],
  },
  {
    id: 'json-schema',
    protocol: 'json-schema',
    label: 'JSON Schema',
    formats: ['JSON', 'YAML'],
    versions: 'draft-04, draft-06, draft-07, 2019-09, 2020-12',
    status: 'supported',
    levels: { parse: 'supported', semanticDiff: 'supported', classification: 'supported' },
    release: 'A',
    notes: [
      'Request (input) or response (output) polarity must be chosen.',
      'Composition, patternProperties, dynamic refs and regex patterns are flagged for review.',
    ],
  },
  {
    id: 'manual-rest',
    protocol: 'manual-rest',
    label: 'Manual REST contract',
    formats: ['In-app builder (JSON)'],
    versions: 'jkyManualRest 1.0',
    status: 'supported',
    levels: { parse: 'supported', semanticDiff: 'supported', classification: 'supported' },
    release: 'A',
    notes: ['Same HTTP rules as OpenAPI; accuracy depends on what was entered manually.'],
  },
  {
    id: 'protobuf',
    protocol: 'grpc',
    label: 'Protocol Buffers / gRPC',
    formats: ['.proto'],
    versions: 'proto2, proto3 (editions parsed, not modelled)',
    status: 'partial',
    levels: { parse: 'partial', semanticDiff: 'partial', classification: 'partial' },
    release: 'B',
    notes: [
      'Single-file analysis; imports are not resolved.',
      'Wire-level vs source-level differences distinguished.',
      'Custom options and extensions are not compared.',
    ],
  },
  {
    id: 'asyncapi',
    protocol: 'asyncapi',
    label: 'AsyncAPI',
    formats: ['JSON', 'YAML'],
    versions: '2.x, 3.x',
    status: 'experimental',
    levels: { parse: 'experimental', semanticDiff: 'experimental', classification: 'experimental' },
    release: 'B',
    notes: [
      'Own structural parser (not @asyncapi/parser); no full spec validation.',
      'Bindings and traits are only checked for changes.',
      'Non-JSON payload schema formats (Avro, Protobuf) are not compared.',
    ],
  },
  {
    id: 'postman-3',
    protocol: 'postman3',
    label: 'Postman Collection v3 (multi-file)',
    formats: ['Directory / archive'],
    versions: '3.x',
    status: 'unsupported',
    levels: { parse: 'unsupported', semanticDiff: 'unsupported', classification: 'unsupported' },
    release: 'B',
    notes: [
      'Multi-file archive ingestion is not implemented; v3 documents are detected and rejected with an explanation.',
    ],
  },
  {
    id: 'cross-format-http',
    protocol: null,
    label: 'Cross-format HTTP comparison',
    formats: ['Swagger 2.0 ↔ OpenAPI 3.x', 'Postman v2.1 ↔ OpenAPI'],
    versions: 'opt-in',
    status: 'experimental',
    levels: { parse: 'supported', semanticDiff: 'experimental', classification: 'experimental' },
    release: 'C',
    notes: [
      'Requires explicit opt-in; findings carry a lossy-projection notice.',
      'REST is never compared against GraphQL, gRPC or AsyncAPI.',
    ],
  },
  {
    id: 'cli',
    protocol: null,
    label: 'Command-line interface',
    formats: ['npm run radar -- compare <old> <new>'],
    versions: '1.0',
    status: 'supported',
    levels: { parse: 'supported', semanticDiff: 'supported', classification: 'supported' },
    release: 'C',
    notes: ['Same engine as the server; exits 1 when the gate blocks.'],
  },
  {
    id: 'url-import',
    protocol: null,
    label: 'Import from public URL',
    formats: ['HTTPS'],
    versions: '—',
    status: 'unsupported',
    levels: { parse: 'unsupported', semanticDiff: 'unsupported', classification: 'unsupported' },
    release: 'C',
    notes: ['Not implemented. No server-side fetching of user-supplied URLs (SSRF protection).'],
  },
];

export function adapterStatusFor(protocol: Protocol, formatVersion: string): SupportStatus {
  if (protocol === 'openapi') return /^3\.2\./.test(formatVersion) ? 'partial' : 'supported';
  if (protocol === 'graphql') return 'supported';
  const cap = CAPABILITIES.find((c) => c.protocol === protocol);
  return cap?.status ?? 'unsupported';
}

export function capabilityReport() {
  return CAPABILITIES.map((c) => {
    const rules = c.protocol ? ruleRegistry.forProtocol(c.protocol) : [];
    return { ...c, rules: { registered: rules.length, tested: rules.filter((r) => r.tested).length } };
  });
}
