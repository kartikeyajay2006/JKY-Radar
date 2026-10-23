/** @import { AnalysisOptions, AnalysisResult, Diagnostic, HttpContractModel, JsonSchemaContractModel, ParsedContract, Protocol, ReleasePolicy, SupportStatus } from '@jky/radar-core' */
/** @import { DetectionResult } from './detect.js' */
/** @import { ParseLimits } from './parse/structured.js' */
/** @import { PostmanModel } from './postman2/postman2.js' */
/** @import { GraphQLModel } from './graphql/graphql.js' */
/** @import { ProtoModel } from './protobuf/protobuf.js' */
/** @import { AsyncModel } from './asyncapi/asyncapi.js' */

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
import { detectFormat } from './detect.js';
import { parseStructured, StructuredParseError, DEFAULT_LIMITS } from './parse/structured.js';
import { parseOpenApi } from './openapi/openapi.js';
import { parseSwagger2 } from './swagger2/swagger2.js';
import { parseJsonSchema } from './jsonschema/jsonschema.js';
import { parseManualRest } from './manual/manual.js';
import { diffPostman, parsePostman2, projectPostmanToHttp } from './postman2/postman2.js';
import { diffGraphQL, parseGraphQLIntrospection, parseGraphQLSdl } from './graphql/graphql.js';
import { diffProto, parseProto } from './protobuf/protobuf.js';
import { diffAsyncApi, parseAsyncApi } from './asyncapi/asyncapi.js';

/**
 * @typedef {Object} ContractInput
 * @property {string} content
 * @property {string} [fileName]
 * @property {Protocol} [protocol] - User override; must not contradict a high-confidence detection.
 */

/** @typedef {| { ok: true; contract: ParsedContract; detection: DetectionResult } | { ok: false; diagnostics: Diagnostic[]; detection: DetectionResult }} ParseOutcome */

/**
 * @param {DetectionResult} detection
 * @param {string} code
 * @param {string} message
 * @param {number} [line]
 * @param {number} [column]
 * @returns {ParseOutcome}
 */
const fail = (detection, code, message, line, column) => {
  /** @type {Diagnostic} */
  const d = { severity: 'error', code, message };
  if (line !== undefined) d.source = { line, ...(column !== undefined ? { column } : {}) };
  return { ok: false, diagnostics: [d], detection };
};

/**
 * @param {ContractInput} input
 * @param {ParseLimits} [limits]
 * @returns {ParseOutcome}
 */
export function parseContract(input, limits = DEFAULT_LIMITS) {
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
    /** @type {ParsedContract} */
    let contract;
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
      `The ${PROTOCOL_LABEL[protocol]} parser could not process this document: ${/** @type {Error} */ (e).message.slice(0, 300)}`,
    );
  }
}

/**
 * @typedef {Object} AnalyzeInput
 * @property {ContractInput} baseline
 * @property {ContractInput} candidate
 * @property {AnalysisOptions} [options]
 * @property {ReleasePolicy} [policy]
 * @property {ParseLimits} [limits]
 */

/** @typedef {| { ok: true; result: AnalysisResult } | { ok: false; code: string; message: string; baseline?: Diagnostic[]; candidate?: Diagnostic[] }} AnalyzeOutcome */

/**
 * @param {AnalyzeInput} input
 * @returns {AnalyzeOutcome}
 */
export function analyzeContracts(input) {
  const a = parseContract(input.baseline, input.limits);
  const b = parseContract(input.candidate, input.limits);
  if (a.ok === false || b.ok === false) {
    return {
      ok: false,
      code: 'INVALID_CONTRACT',
      message: 'One or both contracts failed validation.',
      ...(a.ok === false ? { baseline: a.diagnostics } : {}),
      ...(b.ok === false ? { candidate: b.diagnostics } : {}),
    };
  }
  return analyzeParsed(a.contract, b.contract, input.options ?? {}, input.policy);
}

/** @type {Record<SupportStatus, number>} */
const STATUS_RANK = {
  supported: 0,
  partial: 1,
  experimental: 2,
  unsupported: 3,
};

/**
 * @param {ParsedContract} a
 * @param {ParsedContract} b
 * @param {AnalysisOptions} options
 * @param {ReleasePolicy} [policy]
 * @returns {AnalyzeOutcome}
 */
export function analyzeParsed(a, b, options, policy) {
  /** @type {AnalysisOptions} */
  const opts = { includeInformational: true, ...options };
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
  /** @type {SupportStatus} */
  let adapterStatus = STATUS_RANK[statusA] >= STATUS_RANK[statusB] ? statusA : statusB;
  /** @type {Protocol} */
  const protocol = b.protocol;
  /** @type {string[]} */
  const reasons = [];
  const heuristic = a.protocol === 'postman2' || b.protocol === 'postman2';
  const emitter = new FindingEmitter({
    protocol,
    includeInformational: opts.includeInformational !== false,
    ...(heuristic
      ? {
          severityCap: /** @type {const} */ ('potentially_breaking'),
          evidence: /** @type {const} */ ('heuristic'),
        }
      : {}),
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
    /**
     * @param {ParsedContract} c
     * @returns {HttpContractModel}
     */
    const toHttp = (c) =>
      c.protocol === 'postman2'
        ? projectPostmanToHttp(/** @type {PostmanModel} */ (c.model))
        : /** @type {HttpContractModel} */ (c.model);
    diffHttp(toHttp(a), toHttp(b), emitter, { operationAliases: opts.operationAliases ?? {} });
    if (heuristic)
      reasons.push('Postman collections carry no authoritative response or requiredness information.');
  } else {
    switch (protocol) {
      case 'openapi':
      case 'swagger2':
      case 'manual-rest':
        diffHttp(
          /** @type {HttpContractModel} */ (a.model),
          /** @type {HttpContractModel} */ (b.model),
          emitter,
          {
            operationAliases: opts.operationAliases ?? {},
          },
        );
        if (protocol === 'manual-rest')
          reasons.push(
            'Manually entered contract: findings are only as complete as the entered definitions.',
          );
        break;
      case 'postman2':
        diffPostman(/** @type {PostmanModel} */ (a.model), /** @type {PostmanModel} */ (b.model), emitter);
        reasons.push(
          'Postman collections are not authoritative contracts; response compatibility is not observable.',
        );
        break;
      case 'graphql':
        diffGraphQL(/** @type {GraphQLModel} */ (a.model), /** @type {GraphQLModel} */ (b.model), emitter);
        break;
      case 'grpc': {
        const editions = a.formatVersion.startsWith('edition') || b.formatVersion.startsWith('edition');
        diffProto(
          /** @type {ProtoModel} */ (a.model),
          /** @type {ProtoModel} */ (b.model),
          emitter,
          editions,
        );
        break;
      }
      case 'asyncapi': {
        const am = /** @type {AsyncModel} */ (a.model);
        const bm = /** @type {AsyncModel} */ (b.model);
        if (am.major !== bm.major)
          reasons.push(
            `AsyncAPI ${am.major}.x compared with ${bm.major}.x; operation identities may not align.`,
          );
        diffAsyncApi(am, bm, emitter);
        break;
      }
      case 'json-schema': {
        const am = /** @type {JsonSchemaContractModel} */ (a.model);
        const bm = /** @type {JsonSchemaContractModel} */ (b.model);
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
