/** @import { HttpContractModel, HttpMediaType, HttpOperation, HttpParameter, HttpParamLocation, HttpResponse, ParsedContract, SecurityRequirement, SecuritySchemeDef } from '@jky/radar-core' */
/** @import { SchemaDialect } from '@jky/radar-core' */
/** @import { StructuredDocument } from '../parse/structured.js' */
/** @import { AdapterContext } from '../common.js' */

import {
  asString,
  entries,
  isObject,
  joinPointer,
  normalizePathTemplate,
  normalizeSchema,
  operationKey,
  pathParamNames,
} from '@jky/radar-core';

import { createAdapterContext, error, finishContract, resolveObject, warn } from '../common.js';

const METHODS_30 = /** @type {const} */ ([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);
const IGNORED_HEADER_PARAMS = new Set(['accept', 'content-type', 'authorization']);

/**
 * @param {StructuredDocument} doc
 * @returns {ParsedContract<HttpContractModel>}
 */
export function parseOpenApi(doc) {
  const root = /** @type {Record<string, unknown>} */ (doc.value);
  const version = String(root.openapi ?? '');
  const minor = /^3\.(\d+)\./.exec(version)?.[1];
  /** @type {SchemaDialect} */
  const dialect = minor === '0' ? 'oas30' : minor === '1' ? 'oas31' : 'oas32';
  const ctx = createAdapterContext(doc, dialect);

  if (!/^3\.[0-2]\.\d+/.test(version)) {
    error(
      ctx,
      'UNSUPPORTED_VERSION',
      `OpenAPI version "${version}" is not supported (expected 3.0.x, 3.1.x or 3.2.x).`,
      '/openapi',
    );
  }
  if (minor === '2') {
    warn(
      ctx,
      'OAS32_PARTIAL',
      'OpenAPI 3.2 support is partial: QUERY and additionalOperations are compared; itemSchema, $self and tag hierarchy are not.',
      '/openapi',
      'info',
    );
  }
  if (
    minor === '1' &&
    typeof root.jsonSchemaDialect === 'string' &&
    !/2020-12/.test(root.jsonSchemaDialect)
  ) {
    warn(
      ctx,
      'JSON_SCHEMA_DIALECT',
      `jsonSchemaDialect ${root.jsonSchemaDialect} is not the OAS 3.1 default; schemas are compared with 2020-12 semantics.`,
      '/jsonSchemaDialect',
    );
    ctx.ignored.add('Non-default jsonSchemaDialect');
  }
  if (!isObject(root.info)) error(ctx, 'MISSING_INFO', 'The "info" object is required.', '');
  if (root.paths === undefined && minor === '0')
    error(ctx, 'MISSING_PATHS', 'OpenAPI 3.0 documents require "paths".', '');
  if (root.paths !== undefined && !isObject(root.paths))
    error(ctx, 'INVALID_PATHS', '"paths" must be an object.', '/paths');
  if (root.webhooks !== undefined) ctx.ignored.add('webhooks');

  const info = isObject(root.info) ? root.info : {};
  const servers = parseServers(root.servers, '/servers');
  const securitySchemes = parseSecuritySchemes(ctx, root);
  const rootSecurity = parseSecurity(root.security);

  /** @type {HttpOperation[]} */
  const operations = [];
  const seenNormalized = /** @type {Map<string, string>} */ (new Map());
  for (const [path, rawItem] of entries(root.paths)) {
    const itemPtr = joinPointer('/paths', path);
    if (!path.startsWith('/')) error(ctx, 'INVALID_PATH', `Path "${path}" must start with "/".`, itemPtr);
    const norm = normalizePathTemplate(path);
    const clash = seenNormalized.get(norm);
    if (clash !== undefined) {
      error(
        ctx,
        'DUPLICATE_PATH_TEMPLATE',
        `Paths "${clash}" and "${path}" are identical templates (only parameter names differ), which OpenAPI forbids.`,
        itemPtr,
      );
      continue;
    }
    seenNormalized.set(norm, path);
    const resolved = resolveObject(ctx, rawItem, itemPtr);
    if (!resolved) continue;
    const item = resolved.value;
    const pathParams = parseParameters(ctx, item.parameters, joinPointer(resolved.pointer, 'parameters'));
    if (item.servers) ctx.ignored.add('Path/operation-level servers');

    /** @type {Array<[string, unknown, string]>} */
    const methodEntries = METHODS_30.filter((m) => m in item).map((m) => [
      m,
      item[m],
      joinPointer(resolved.pointer, m),
    ]);
    if (dialect === 'oas32') {
      if ('query' in item) methodEntries.push(['query', item.query, joinPointer(resolved.pointer, 'query')]);
      for (const [m, op] of entries(item.additionalOperations)) {
        methodEntries.push([m.toLowerCase(), op, joinPointer(resolved.pointer, 'additionalOperations', m)]);
      }
    }
    for (const [method, rawOp, opPtr] of methodEntries) {
      if (!isObject(rawOp)) {
        error(ctx, 'INVALID_OPERATION', `${method.toUpperCase()} ${path} must be an object.`, opPtr);
        continue;
      }
      operations.push(parseOperation(ctx, method, path, rawOp, opPtr, pathParams, rootSecurity));
    }
  }

  // operationId uniqueness
  const ids = /** @type {Map<string, string>} */ (new Map());
  for (const op of operations) {
    if (!op.operationId) continue;
    const prev = ids.get(op.operationId);
    if (prev)
      error(
        ctx,
        'DUPLICATE_OPERATION_ID',
        `operationId "${op.operationId}" is used by both ${prev} and ${op.displayKey}.`,
        op.src?.jsonPointer,
      );
    ids.set(op.operationId, op.displayKey);
  }

  /** @type {HttpContractModel} */
  const model = {
    kind: 'http',
    info: {
      title: asString(info.title),
      version: asString(info.version),
      description: asString(info.description),
    },
    servers,
    operations: operations.sort((a, b) => a.key.localeCompare(b.key)),
    securitySchemes,
    evidence: 'contract',
  };
  const components = isObject(root.components) ? root.components : {};
  return finishContract(ctx, {
    protocol: 'openapi',
    formatVersion: version,
    title: model.info.title,
    version: model.info.version,
    model,
    stats: {
      paths: seenNormalized.size,
      operations: operations.length,
      schemas: isObject(components.schemas) ? Object.keys(components.schemas).length : 0,
      securitySchemes: Object.keys(securitySchemes).length,
    },
  });

  /**
   * @param {unknown} raw
   * @param {string} ptr
   */
  function parseServers(raw, ptr) {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((s, i) => {
        if (!isObject(s) || typeof s.url !== 'string') return undefined;
        let url = s.url;
        for (const [name, v] of entries(s.variables)) {
          if (isObject(v) && typeof v.default === 'string') url = url.replaceAll(`{${name}}`, v.default);
        }
        const src = ctx.locate(joinPointer(ptr, i));
        return src ? { url, src } : { url };
      })
      .filter(/** @returns {x is { url: string }} */ (x) => !!x);
  }
}

/**
 * @param {unknown} raw
 * @returns {SecurityRequirement[] | undefined}
 */
export function parseSecurity(raw) {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .filter(isObject)
    .map((req) =>
      Object.fromEntries(
        Object.entries(req).map(([k, v]) => [
          k,
          Array.isArray(v) ? v.filter(/** @returns {s is string} */ (s) => typeof s === 'string').sort() : [],
        ]),
      ),
    );
}

/**
 * @param {AdapterContext} ctx
 * @param {Record<string, unknown>} root
 * @returns {Record<string, SecuritySchemeDef>}
 */
function parseSecuritySchemes(ctx, root) {
  /** @type {Record<string, SecuritySchemeDef>} */
  const out = {};
  const comps = isObject(root.components) ? root.components : {};
  for (const [name, raw] of entries(comps.securitySchemes)) {
    const ptr = joinPointer('/components/securitySchemes', name);
    const r = resolveObject(ctx, raw, ptr);
    if (!r) continue;
    const s = r.value;
    /** @type {SecuritySchemeDef} */
    const def = { type: String(s.type ?? 'unknown') };
    if (typeof s.in === 'string') def.in = s.in;
    if (typeof s.name === 'string') def.name = s.name;
    if (typeof s.scheme === 'string') def.scheme = s.scheme;
    if (typeof s.bearerFormat === 'string') def.bearerFormat = s.bearerFormat;
    if (isObject(s.flows)) def.flows = Object.keys(s.flows).sort();
    if (typeof s.openIdConnectUrl === 'string') def.openIdConnectUrl = s.openIdConnectUrl;
    const src = ctx.locate(r.pointer);
    if (src) def.src = src;
    out[name] = def;
  }
  return out;
}

/**
 * @param {AdapterContext} ctx
 * @param {unknown} raw
 * @param {string} ptr
 * @returns {HttpParameter[]}
 */
function parseParameters(ctx, raw, ptr) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    error(ctx, 'INVALID_PARAMETERS', '"parameters" must be an array.', ptr);
    return [];
  }
  /** @type {HttpParameter[]} */
  const out = [];
  raw.forEach((p, i) => {
    const r = resolveObject(ctx, p, joinPointer(ptr, i));
    if (!r) return;
    const v = r.value;
    const name = asString(v.name);
    const loc = /** @type {HttpParamLocation | undefined} */ (asString(v.in));
    if (!name || !loc || !['path', 'query', 'header', 'cookie'].includes(loc)) {
      if (String(v.in) === 'querystring') {
        ctx.ignored.add('in: querystring parameters (OAS 3.2)');
        return;
      }
      error(
        ctx,
        'INVALID_PARAMETER',
        `Parameter at ${r.pointer} needs a "name" and a valid "in".`,
        r.pointer,
      );
      return;
    }
    if (loc === 'header' && IGNORED_HEADER_PARAMS.has(name.toLowerCase())) {
      warn(
        ctx,
        'HEADER_PARAM_IGNORED',
        `Header parameter "${name}" is ignored by OpenAPI (described by other constructs).`,
        r.pointer,
        'info',
      );
      return;
    }
    /** @type {unknown} */
    let schemaRaw = v.schema;
    let schemaPtr = joinPointer(r.pointer, 'schema');
    if (schemaRaw === undefined && isObject(v.content)) {
      const [mt, media] = Object.entries(v.content)[0] ?? [];
      if (mt && isObject(media)) {
        schemaRaw = media.schema;
        schemaPtr = joinPointer(r.pointer, 'content', mt, 'schema');
      }
    }
    /** @type {HttpParameter} */
    const param = {
      name,
      in: loc,
      required: loc === 'path' ? true : v.required === true,
      deprecated: v.deprecated === true,
    };
    if (loc === 'path' && v.required !== true)
      warn(
        ctx,
        'PATH_PARAM_NOT_REQUIRED',
        `Path parameter "${name}" must declare required: true.`,
        r.pointer,
      );
    if (schemaRaw !== undefined) param.schema = normalizeSchema(schemaRaw, schemaPtr, ctx.schemaCtx);
    if (typeof v.style === 'string') param.style = v.style;
    if (typeof v.explode === 'boolean') param.explode = v.explode;
    if (typeof v.description === 'string') param.description = v.description;
    const src = ctx.locate(r.pointer);
    if (src) param.src = src;
    out.push(param);
  });
  return out;
}

/**
 * @param {AdapterContext} ctx
 * @param {unknown} raw
 * @param {string} ptr
 * @returns {Record<string, HttpMediaType>}
 */
function parseContent(ctx, raw, ptr) {
  /** @type {Record<string, HttpMediaType>} */
  const out = {};
  for (const [mt, media] of entries(raw)) {
    const mPtr = joinPointer(ptr, mt);
    /** @type {HttpMediaType} */
    const m = {};
    const src = ctx.locate(mPtr);
    if (src) m.src = src;
    if (isObject(media)) {
      if (media.schema !== undefined)
        m.schema = normalizeSchema(media.schema, joinPointer(mPtr, 'schema'), ctx.schemaCtx);
      if (media.itemSchema !== undefined) ctx.ignored.add('itemSchema (OAS 3.2 streaming media types)');
      if (media.encoding !== undefined) ctx.ignored.add('Media type "encoding" objects');
    }
    out[mt] = m;
  }
  return out;
}

/**
 * @param {AdapterContext} ctx
 * @param {string} method
 * @param {string} path
 * @param {Record<string, unknown>} raw
 * @param {string} ptr
 * @param {HttpParameter[]} pathParams
 * @param {SecurityRequirement[] | undefined} rootSecurity
 * @returns {HttpOperation}
 */
function parseOperation(ctx, method, path, raw, ptr, pathParams, rootSecurity) {
  const opParams = parseParameters(ctx, raw.parameters, joinPointer(ptr, 'parameters'));
  const merged = /** @type {Map<string, HttpParameter>} */ (new Map());
  for (const p of [...pathParams, ...opParams])
    merged.set(`${p.in}:${p.in === 'header' ? p.name.toLowerCase() : p.name}`, p);
  const params = [...merged.values()];

  // Path template parameters must be declared.
  for (const name of pathParamNames(path)) {
    if (!params.some((p) => p.in === 'path' && p.name === name)) {
      warn(
        ctx,
        'PATH_PARAM_UNDECLARED',
        `${method.toUpperCase()} ${path}: path parameter "{${name}}" is not declared.`,
        ptr,
      );
    }
  }

  /** @type {HttpOperation} */
  const op = {
    key: operationKey(method, path),
    displayKey: `${method.toUpperCase()} ${path}`,
    method: method.toUpperCase(),
    path,
    normalizedPath: normalizePathTemplate(path),
    deprecated: raw.deprecated === true,
    parameters: params.sort((a, b) => `${a.in}:${a.name}`.localeCompare(`${b.in}:${b.name}`)),
    responses: {},
    security: parseSecurity(raw.security) ?? rootSecurity ?? [],
  };
  const src = ctx.locate(ptr);
  if (src) op.src = src;
  if (typeof raw.operationId === 'string') op.operationId = raw.operationId;
  if (typeof raw.summary === 'string') op.summary = raw.summary;
  if (typeof raw.description === 'string') op.description = raw.description;
  if (raw.callbacks !== undefined) ctx.ignored.add('callbacks');

  if (raw.requestBody !== undefined) {
    const r = resolveObject(ctx, raw.requestBody, joinPointer(ptr, 'requestBody'));
    if (r) {
      op.requestBody = {
        required: r.value.required === true,
        content: parseContent(ctx, r.value.content, joinPointer(r.pointer, 'content')),
      };
      const bsrc = ctx.locate(r.pointer);
      if (bsrc) op.requestBody.src = bsrc;
      if (typeof r.value.description === 'string') op.requestBody.description = r.value.description;
    }
  }

  for (const [status, rawResp] of entries(raw.responses)) {
    const rPtr = joinPointer(ptr, 'responses', status);
    if (!/^([1-5]\d\d|[1-5]XX|default)$/i.test(status)) {
      if (status.startsWith('x-')) continue;
      warn(ctx, 'INVALID_STATUS', `Response key "${status}" is not a valid status code.`, rPtr);
      continue;
    }
    const r = resolveObject(ctx, rawResp, rPtr);
    if (!r) continue;
    /** @type {HttpResponse} */
    const resp = {
      status: status.toUpperCase(),
      content: parseContent(ctx, r.value.content, joinPointer(r.pointer, 'content')),
      headers: {},
    };
    if (typeof r.value.description === 'string') resp.description = r.value.description;
    const rsrc = ctx.locate(r.pointer);
    if (rsrc) resp.src = rsrc;
    for (const [h, rawH] of entries(r.value.headers)) {
      const hr = resolveObject(ctx, rawH, joinPointer(r.pointer, 'headers', h));
      if (!hr) continue;
      /** @type {HttpResponse['headers'][string]} */
      const header = { required: hr.value.required === true };
      if (hr.value.schema !== undefined)
        header.schema = normalizeSchema(hr.value.schema, joinPointer(hr.pointer, 'schema'), ctx.schemaCtx);
      const hsrc = ctx.locate(hr.pointer);
      if (hsrc) header.src = hsrc;
      resp.headers[h] = header;
    }
    if (r.value.links !== undefined) ctx.ignored.add('Response links');
    op.responses[resp.status] = resp;
  }
  if (Object.keys(op.responses).length === 0)
    warn(ctx, 'NO_RESPONSES', `${op.displayKey} documents no responses.`, ptr);
  return op;
}
