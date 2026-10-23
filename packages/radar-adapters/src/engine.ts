import type {
  AnalysisOptions,
  AnalysisResult,
  Diagnostic,
  HttpContractModel,
  JsonSchemaContractModel,
  ParsedContract,
  Protocol,
  ReleasePolicy,
  SupportStatus,
} from '@jky/radar-core';
import {
  diffHttp,
  finalizeAnalysis,
  FindingEmitter,
  PROTOCOL_FAMILY,
  PROTOCOL_LABEL,
  SchemaComparator,
} from '@jky/radar-core';
import { adapterStatusFor } from './capabilities.js';
import { ADAPTER_VERSION, ContractValidationError } from './common.js';
import { detectFormat, type DetectionResult } from './detect.js';
import {
  parseStructured,
  StructuredParseError,
  DEFAULT_LIMITS,
  type ParseLimits,
} from './parse/structured.js';
import { parseOpenApi } from './openapi/openapi.js';
import { parseSwagger2 } from './swagger2/swagger2.js';
import { parseJsonSchema } from './jsonschema/jsonschema.js';
import { parseManualRest } from './manual/manual.js';
import { diffPostman, parsePostman2, projectPostmanToHttp, type PostmanModel } from './postman2/postman2.js';
import {
  diffGraphQL,
  parseGraphQLIntrospection,
  parseGraphQLSdl,
  type GraphQLModel,
} from './graphql/graphql.js';
import { diffProto, parseProto, type ProtoModel } from './protobuf/protobuf.js';
import { diffAsyncApi, parseAsyncApi, type AsyncModel } from './asyncapi/asyncapi.js';

export interface ContractInput {
  content: string;
  fileName?: string;
  /** User override; must not contradict a high-confidence detection. */
  protocol?: Protocol;
}

export type ParseOutcome =
  | { ok: true; contract: ParsedContract; detection: DetectionResult }
  | { ok: false; diagnostics: Diagnostic[]; detection: DetectionResult };

const fail = (
  detection: DetectionResult,
  code: string,
  message: string,
  line?: number,
  column?: number,
): ParseOutcome => {
  const d: Diagnostic = { severity: 'error', code, message };
  if (line !== undefined) d.source = { line, ...(column !== undefined ? { column } : {}) };
  return { ok: false, diagnostics: [d], detection };
};

export function parseContract(input: ContractInput, limits: ParseLimits = DEFAULT_LIMITS): ParseOutcome {
  const detection = detectFormat(input.content, input.fileName, limits);
  if (detection.error)
    return fail(
      detection,
      detection.error.code,
      detection.error.message,
      detection.error.line,
      detection.error.column,
    );
  const protocol = input.protocol ?? detection.protocol;
  if (!protocol) {
    return fail(
      detection,
      'UNKNOWN_FORMAT',
      'Could not detect a supported contract format. Supported: OpenAPI 3.x, Swagger 2.0, GraphQL SDL/introspection, Postman v2.1, JSON Schema, JKY manual REST, Protobuf (.proto), AsyncAPI 2/3.',
    );
  }
  if (
    input.protocol &&
    detection.protocol &&
    detection.protocol !== input.protocol &&
    detection.confidence === 'high'
  ) {
    return fail(
      detection,
      'PROTOCOL_MISMATCH',
      `The document looks like ${PROTOCOL_LABEL[detection.protocol]} (${detection.reasons.join('; ')}) but ${PROTOCOL_LABEL[input.protocol]} was selected.`,
    );
  }
  if (protocol === 'postman3') {
    return fail(
      detection,
      'UNSUPPORTED_FORMAT',
      'Postman Collection v3 is a multi-file format; archive/directory ingestion is not supported yet. Export the collection as v2.1 JSON instead.',
    );
  }
  try {
    let contract: ParsedContract;
    if (protocol === 'graphql') {
      contract =
        detection.syntax === 'json' || detection.syntax === 'yaml'
          ? parseGraphQLIntrospection(parseStructured(input.content, limits).value)
          : parseGraphQLSdl(input.content);
    } else if (protocol === 'grpc') {
      contract = parseProto(input.content);
    } else {
      const doc = parseStructured(input.content, limits);
      switch (protocol) {
        case 'openapi':
          contract = parseOpenApi(doc);
          break;
        case 'swagger2':
          contract = parseSwagger2(doc);
          break;
        case 'json-schema':
          contract = parseJsonSchema(doc);
          break;
        case 'manual-rest':
          contract = parseManualRest(doc);
          break;
        case 'postman2':
          contract = parsePostman2(doc);
          break;
        case 'asyncapi':
          contract = parseAsyncApi(doc);
          break;
        default:
          return fail(detection, 'UNSUPPORTED_FORMAT', `Protocol ${protocol} is not supported.`);
      }
    }
    return { ok: true, contract, detection };
  } catch (e) {
    if (e instanceof ContractValidationError) return { ok: false, diagnostics: e.diagnostics, detection };
    if (e instanceof StructuredParseError) return fail(detection, e.code, e.message, e.line, e.column);
    return fail(
      detection,
      'PARSER_FAILURE',
      `The ${PROTOCOL_LABEL[protocol]} parser could not process this document: ${(e as Error).message.slice(0, 300)}`,
    );
  }
}

export interface AnalyzeInput {
  baseline: ContractInput;
  candidate: ContractInput;
  options?: AnalysisOptions;
  policy?: ReleasePolicy;
  limits?: ParseLimits;
}

export type AnalyzeOutcome =
  | { ok: true; result: AnalysisResult }
  | { ok: false; code: string; message: string; baseline?: Diagnostic[]; candidate?: Diagnostic[] };

export function analyzeContracts(input: AnalyzeInput): AnalyzeOutcome {
  const a = parseContract(input.baseline, input.limits);
  const b = parseContract(input.candidate, input.limits);
  if (!a.ok || !b.ok) {
    return {
      ok: false,
      code: 'INVALID_CONTRACT',
      message: 'One or both contracts failed validation.',
      ...(a.ok ? {} : { baseline: a.diagnostics }),
      ...(b.ok ? {} : { candidate: b.diagnostics }),
    };
  }
  return analyzeParsed(a.contract, b.contract, input.options ?? {}, input.policy);
}

const STATUS_RANK: Record<SupportStatus, number> = {
  supported: 0,
  partial: 1,
  experimental: 2,
  unsupported: 3,
};

export function analyzeParsed(
  a: ParsedContract,
  b: ParsedContract,
  options: AnalysisOptions,
  policy?: ReleasePolicy,
): AnalyzeOutcome {
  const opts: AnalysisOptions = { includeInformational: true, ...options };
  const sameProtocol = a.protocol === b.protocol;
  const bothHttp = PROTOCOL_FAMILY[a.protocol] === 'http' && PROTOCOL_FAMILY[b.protocol] === 'http';
  if (!sameProtocol && !(bothHttp && opts.allowCrossFormat)) {
    return {
      ok: false,
      code: 'PROTOCOL_MISMATCH',
      message: bothHttp
        ? `Baseline is ${PROTOCOL_LABEL[a.protocol]} and candidate is ${PROTOCOL_LABEL[b.protocol]}. Enable cross-format comparison to compare them through the canonical HTTP model.`
        : `Cannot compare ${PROTOCOL_LABEL[a.protocol]} with ${PROTOCOL_LABEL[b.protocol]}: different protocol families are never treated as equivalent.`,
    };
  }
  const statusA = adapterStatusFor(a.protocol, a.formatVersion);
  const statusB = adapterStatusFor(b.protocol, b.formatVersion);
  let adapterStatus: SupportStatus = STATUS_RANK[statusA] >= STATUS_RANK[statusB] ? statusA : statusB;
  const protocol: Protocol = b.protocol;
  const reasons: string[] = [];
  const heuristic = a.protocol === 'postman2' || b.protocol === 'postman2';
  const emitter = new FindingEmitter({
    protocol,
    includeInformational: opts.includeInformational !== false,
    ...(heuristic ? { severityCap: 'potentially_breaking' as const, evidence: 'heuristic' as const } : {}),
  });

  if (!sameProtocol) {
    adapterStatus = STATUS_RANK[adapterStatus] >= STATUS_RANK.experimental ? adapterStatus : 'experimental';
    reasons.push(
      `Cross-format projection ${PROTOCOL_LABEL[a.protocol]} → ${PROTOCOL_LABEL[b.protocol]}; format-specific constructs are not compared.`,
    );
    emitter.emit('XFMT_PROJECTION_LOSSY', {
      logicalPath: 'comparison',
      message: `Compared ${PROTOCOL_LABEL[a.protocol]} (${a.formatVersion}) with ${PROTOCOL_LABEL[b.protocol]} (${b.formatVersion}) through the canonical HTTP model.`,
      before: a.protocol,
      after: b.protocol,
    });
    const toHttp = (c: ParsedContract): HttpContractModel =>
      c.protocol === 'postman2'
        ? projectPostmanToHttp(c.model as PostmanModel)
        : (c.model as HttpContractModel);
    diffHttp(toHttp(a), toHttp(b), emitter, { operationAliases: opts.operationAliases ?? {} });
    if (heuristic)
      reasons.push('Postman collections carry no authoritative response or requiredness information.');
  } else {
    switch (protocol) {
      case 'openapi':
      case 'swagger2':
      case 'manual-rest':
        diffHttp(a.model as HttpContractModel, b.model as HttpContractModel, emitter, {
          operationAliases: opts.operationAliases ?? {},
        });
        if (protocol === 'manual-rest')
          reasons.push(
            'Manually entered contract: findings are only as complete as the entered definitions.',
          );
        break;
      case 'postman2':
        diffPostman(a.model as PostmanModel, b.model as PostmanModel, emitter);
        reasons.push(
          'Postman collections are not authoritative contracts; response compatibility is not observable.',
        );
        break;
      case 'graphql':
        diffGraphQL(a.model as GraphQLModel, b.model as GraphQLModel, emitter);
        break;
      case 'grpc': {
        const editions = a.formatVersion.startsWith('edition') || b.formatVersion.startsWith('edition');
        diffProto(a.model as ProtoModel, b.model as ProtoModel, emitter, editions);
        break;
      }
      case 'asyncapi': {
        const am = a.model as AsyncModel;
        const bm = b.model as AsyncModel;
        if (am.major !== bm.major)
          reasons.push(
            `AsyncAPI ${am.major}.x compared with ${bm.major}.x; operation identities may not align.`,
          );
        diffAsyncApi(am, bm, emitter);
        break;
      }
      case 'json-schema': {
        const am = a.model as JsonSchemaContractModel;
        const bm = b.model as JsonSchemaContractModel;
        const polarity = opts.jsonSchemaPolarity ?? 'response';
        opts.jsonSchemaPolarity = polarity;
        if (am.dialect !== bm.dialect) {
          emitter.emit('JSON_SCHEMA_DIALECT_CHANGED', {
            logicalPath: '$schema',
            message: `Dialect changed from ${am.dialect} to ${bm.dialect}.`,
            before: am.dialect,
            after: bm.dialect,
          });
        }
        new SchemaComparator().emitComparison(emitter, am.root, bm.root, polarity, {
          logicalPath: '$',
          entityKey: '$',
        });
        break;
      }
      default:
        return { ok: false, code: 'UNSUPPORTED_FORMAT', message: `Protocol ${protocol} cannot be analysed.` };
    }
  }

  const result = finalizeAnalysis({
    protocol,
    comparisonMode: sameProtocol ? 'same_protocol' : 'cross_format_http',
    baseline: a,
    candidate: b,
    emitter,
    adapterStatus,
    adapterVersion: ADAPTER_VERSION,
    options: opts,
    coverageReasons: reasons,
    ...(sameProtocol ? {} : { statusLabel: 'Cross-format comparison' }),
    ...(policy ? { policy } : {}),
  });
  return { ok: true, result };
}
