/** @import { Protocol } from '@jky/radar-core' */
/** @import { ParseLimits } from './parse/structured.js' */

import { isObject } from '@jky/radar-core';
import { parseStructured, StructuredParseError, DEFAULT_LIMITS } from './parse/structured.js';

/**
 * @typedef {Object} DetectionResult
 * @property {Protocol | null} protocol
 * @property {string | null} formatVersion
 * @property {'high' | 'medium' | 'low'} confidence
 * @property {string[]} reasons
 * @property {'json' | 'yaml' | 'graphql-sdl' | 'proto' | 'unknown'} syntax
 * @property {{ code: string; message: string; line?: number; column?: number }} [error]
 */

const GRAPHQL_SDL =
  /^\s*(?:#[^\n]*\n\s*)*(?:"""[\s\S]*?"""\s*|"[^"\n]*"\s*)?(?:schema|type|interface|enum|input|union|scalar|directive|extend)\b[\s\S]*[{@=]/;
const PROTO =
  /(?:^|\n)\s*(?:syntax\s*=\s*["']proto[23]["']|edition\s*=\s*["']\d+["']|package\s+[\w.]+\s*;|message\s+\w+\s*\{|service\s+\w+\s*\{)/;

/**
 * @param {unknown} value
 * @returns {Omit<DetectionResult, 'syntax'>}
 */
export function detectStructured(value) {
  if (!isObject(value)) {
    return {
      protocol: null,
      formatVersion: null,
      confidence: 'low',
      reasons: ['Top-level value is not an object.'],
    };
  }
  const v = value;
  if (typeof v.openapi === 'string') {
    const ver = v.openapi;
    if (/^3\.[0-2]\.\d+/.test(ver))
      return { protocol: 'openapi', formatVersion: ver, confidence: 'high', reasons: [`openapi: ${ver}`] };
    return {
      protocol: 'openapi',
      formatVersion: ver,
      confidence: 'low',
      reasons: [`Unrecognised OpenAPI version ${ver}`],
    };
  }
  if (v.swagger !== undefined) {
    return {
      protocol: 'swagger2',
      formatVersion: String(v.swagger),
      confidence: String(v.swagger) === '2.0' ? 'high' : 'low',
      reasons: [`swagger: ${String(v.swagger)}`],
    };
  }
  if (typeof v.asyncapi === 'string') {
    return {
      protocol: 'asyncapi',
      formatVersion: v.asyncapi,
      confidence: /^[23]\./.test(v.asyncapi) ? 'high' : 'low',
      reasons: [`asyncapi: ${v.asyncapi}`],
    };
  }
  if (typeof v.jkyManualRest === 'string') {
    return {
      protocol: 'manual-rest',
      formatVersion: v.jkyManualRest,
      confidence: 'high',
      reasons: ['jkyManualRest marker'],
    };
  }
  const info = isObject(v.info) ? v.info : undefined;
  const schemaUrl = typeof info?.schema === 'string' ? info.schema : '';
  if (
    /getpostman\.com\/json\/collection\/v2\.[01]/.test(schemaUrl) ||
    (info && '_postman_id' in info && Array.isArray(v.item))
  ) {
    const ver = /v2\.0/.test(schemaUrl) ? '2.0.0' : '2.1.0';
    return {
      protocol: 'postman2',
      formatVersion: ver,
      confidence: 'high',
      reasons: [`Postman schema ${schemaUrl || '(_postman_id present)'}`],
    };
  }
  if (/collection\/v3|\/v3\./.test(schemaUrl) || typeof v.$kind === 'string') {
    return {
      protocol: 'postman3',
      formatVersion: '3',
      confidence: 'medium',
      reasons: ['Postman v3 markers'],
    };
  }
  const data = isObject(v.data) ? v.data : undefined;
  if (isObject(v.__schema) || (data && isObject(data.__schema))) {
    return {
      protocol: 'graphql',
      formatVersion: 'introspection',
      confidence: 'high',
      reasons: ['GraphQL introspection result (__schema)'],
    };
  }
  if (typeof v.$schema === 'string' && /json-schema\.org/.test(v.$schema)) {
    return {
      protocol: 'json-schema',
      formatVersion: v.$schema,
      confidence: 'high',
      reasons: [`$schema ${v.$schema}`],
    };
  }
  if (
    'properties' in v ||
    'type' in v ||
    '$defs' in v ||
    'definitions' in v ||
    'allOf' in v ||
    'oneOf' in v
  ) {
    return {
      protocol: 'json-schema',
      formatVersion: 'unspecified',
      confidence: 'medium',
      reasons: ['Looks like a JSON Schema (type/properties keywords).'],
    };
  }
  return {
    protocol: null,
    formatVersion: null,
    confidence: 'low',
    reasons: ['No known contract markers found.'],
  };
}

/**
 * @param {string} content
 * @param {string} [fileName]
 * @param {ParseLimits} [limits]
 * @returns {DetectionResult}
 */
export function detectFormat(content, fileName, limits = DEFAULT_LIMITS) {
  const text = content.replace(/^\uFEFF/, '');
  const first = text.trimStart()[0];
  const ext = fileName?.toLowerCase().split('.').pop();
  const structuredStart = first === '{' || first === '[';
  if (!structuredStart) {
    const proto =
      PROTO.test(text) && !/^\s*(?:type|interface|input|union|scalar|schema)\s+\w*\s*\{/m.test(text);
    if (proto) {
      const ed = /edition\s*=\s*["'](\d+)["']/.exec(text);
      const syn = /syntax\s*=\s*["'](proto[23])["']/.exec(text);
      return {
        protocol: 'grpc',
        formatVersion: ed ? `edition-${ed[1]}` : (syn?.[1] ?? 'proto2'),
        confidence: 'high',
        reasons: ['Protocol Buffers definitions'],
        syntax: 'proto',
      };
    }
    if (GRAPHQL_SDL.test(text)) {
      return {
        protocol: 'graphql',
        formatVersion: 'sdl',
        confidence: 'high',
        reasons: ['GraphQL SDL definitions'],
        syntax: 'graphql-sdl',
      };
    }
  }
  try {
    const doc = parseStructured(text, limits);
    const structured = detectStructured(doc.value);
    if (!structured.protocol && !structuredStart && (ext === 'graphql' || ext === 'gql')) {
      return {
        protocol: 'graphql',
        formatVersion: 'sdl',
        confidence: 'low',
        reasons: ['File extension hint (.graphql)'],
        syntax: 'graphql-sdl',
      };
    }
    return { ...structured, syntax: doc.format };
  } catch (e) {
    if (e instanceof StructuredParseError) {
      if (!structuredStart && (ext === 'graphql' || ext === 'gql' || ext === 'proto')) {
        const protocol = ext === 'proto' ? 'grpc' : 'graphql';
        return {
          protocol,
          formatVersion: ext === 'proto' ? 'proto2' : 'sdl',
          confidence: 'low',
          reasons: [`File extension hint (.${ext})`],
          syntax: ext === 'proto' ? 'proto' : 'graphql-sdl',
        };
      }
      /** @type {NonNullable<DetectionResult['error']>} */
      const err = { code: e.code, message: e.message };
      if (e.line !== undefined) err.line = e.line;
      if (e.column !== undefined) err.column = e.column;
      return {
        protocol: null,
        formatVersion: null,
        confidence: 'low',
        reasons: ['Document could not be parsed.'],
        syntax: 'unknown',
        error: err,
      };
    }
    throw e;
  }
}
