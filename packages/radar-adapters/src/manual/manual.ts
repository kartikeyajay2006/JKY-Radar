import type {
  HttpContractModel,
  HttpMediaType,
  HttpOperation,
  HttpParameter,
  HttpParamLocation,
  HttpResponse,
  ParsedContract,
  SecuritySchemeDef,
} from '@jky/radar-core';
import {
  asString,
  entries,
  isObject,
  joinPointer,
  normalizePathTemplate,
  normalizeSchema,
  operationKey,
} from '@jky/radar-core';
import type { StructuredDocument } from '../parse/structured.js';
import { createAdapterContext, error, finishContract, warn } from '../common.js';
import { parseSecurity } from '../openapi/openapi.js';

const METHODS = new Set(['GET', 'PUT', 'POST', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE']);

/**
 * JKY-Radar manual REST contract format (produced by the in-app builder):
 * { jkyManualRest: "1.0", title, version, servers: [url], securitySchemes, security,
 *   schemas: { Name: <JSON Schema> },                     // referenced as "#/schemas/Name"
 *   endpoints: [{ method, path, operationId?, summary?, deprecated?, security?,
 *                 parameters: [{ name, in, required, schema }],
 *                 requestBody?: { required, contentType, schema },
 *                 responses: [{ status, contentType?, description?, schema? }] }] }
 */
export function parseManualRest(doc: StructuredDocument): ParsedContract<HttpContractModel> {
  const root = doc.value as Record<string, unknown>;
  const ctx = createAdapterContext(doc, 'draft2020');
  if (root.jkyManualRest !== '1.0')
    error(
      ctx,
      'UNSUPPORTED_VERSION',
      `jkyManualRest "${String(root.jkyManualRest)}" is not supported (expected "1.0").`,
      '/jkyManualRest',
    );
  if (!Array.isArray(root.endpoints)) error(ctx, 'MISSING_ENDPOINTS', '"endpoints" must be an array.', '');
  warn(
    ctx,
    'MANUAL_CONTRACT',
    'Manually entered contract: findings are only as accurate as the entered definitions.',
    '',
    'info',
  );

  const securitySchemes: Record<string, SecuritySchemeDef> = {};
  for (const [name, raw] of entries(root.securitySchemes)) {
    if (!isObject(raw)) continue;
    const def: SecuritySchemeDef = { type: String(raw.type ?? 'unknown') };
    if (typeof raw.in === 'string') def.in = raw.in;
    if (typeof raw.name === 'string') def.name = raw.name;
    if (typeof raw.scheme === 'string') def.scheme = raw.scheme;
    securitySchemes[name] = def;
  }
  const rootSecurity = parseSecurity(root.security);
  const operations: HttpOperation[] = [];
  const keys = new Set<string>();
  (Array.isArray(root.endpoints) ? root.endpoints : []).forEach((rawEp, i) => {
    const ptr = joinPointer('/endpoints', i);
    if (!isObject(rawEp))
      return void error(ctx, 'INVALID_ENDPOINT', `Endpoint #${i + 1} must be an object.`, ptr);
    const method = String(rawEp.method ?? '').toUpperCase();
    const path = String(rawEp.path ?? '');
    if (!METHODS.has(method))
      return void error(ctx, 'INVALID_METHOD', `Endpoint #${i + 1}: unsupported method "${method}".`, ptr);
    if (!path.startsWith('/'))
      return void error(ctx, 'INVALID_PATH', `Endpoint #${i + 1}: path must start with "/".`, ptr);
    const key = operationKey(method, path);
    if (keys.has(key))
      return void error(
        ctx,
        'DUPLICATE_OPERATION',
        `Endpoint ${method} ${path} is defined twice (paths differing only by parameter names are identical).`,
        ptr,
      );
    keys.add(key);
    const op: HttpOperation = {
      key,
      displayKey: `${method} ${path}`,
      method,
      path,
      normalizedPath: normalizePathTemplate(path),
      deprecated: rawEp.deprecated === true,
      parameters: [],
      responses: {},
      security: parseSecurity(rawEp.security) ?? rootSecurity ?? [],
    };
    const src = ctx.locate(ptr);
    if (src) op.src = src;
    if (typeof rawEp.operationId === 'string') op.operationId = rawEp.operationId;
    if (typeof rawEp.summary === 'string') op.summary = rawEp.summary;
    (Array.isArray(rawEp.parameters) ? rawEp.parameters : []).forEach((rp, j) => {
      const pp = joinPointer(ptr, 'parameters', j);
      if (
        !isObject(rp) ||
        typeof rp.name !== 'string' ||
        !['path', 'query', 'header', 'cookie'].includes(String(rp.in))
      ) {
        return void error(
          ctx,
          'INVALID_PARAMETER',
          `${op.displayKey}: parameter #${j + 1} needs a name and a valid "in".`,
          pp,
        );
      }
      const p: HttpParameter = {
        name: rp.name,
        in: rp.in as HttpParamLocation,
        required: rp.in === 'path' ? true : rp.required === true,
        deprecated: rp.deprecated === true,
      };
      if (rp.schema !== undefined)
        p.schema = normalizeSchema(rp.schema, joinPointer(pp, 'schema'), ctx.schemaCtx);
      const psrc = ctx.locate(pp);
      if (psrc) p.src = psrc;
      op.parameters.push(p);
    });
    if (isObject(rawEp.requestBody)) {
      const bp = joinPointer(ptr, 'requestBody');
      const mt = asString(rawEp.requestBody.contentType) ?? 'application/json';
      const media: HttpMediaType = {};
      if (rawEp.requestBody.schema !== undefined)
        media.schema = normalizeSchema(rawEp.requestBody.schema, joinPointer(bp, 'schema'), ctx.schemaCtx);
      op.requestBody = { required: rawEp.requestBody.required === true, content: { [mt]: media } };
      const bsrc = ctx.locate(bp);
      if (bsrc) op.requestBody.src = bsrc;
    }
    (Array.isArray(rawEp.responses) ? rawEp.responses : []).forEach((rr, j) => {
      const rp = joinPointer(ptr, 'responses', j);
      if (!isObject(rr)) return;
      const status = String(rr.status ?? '').toUpperCase();
      if (!/^([1-5]\d\d|[1-5]XX|DEFAULT)$/.test(status))
        return void error(ctx, 'INVALID_STATUS', `${op.displayKey}: invalid status "${status}".`, rp);
      const resp: HttpResponse = op.responses[status] ?? { status, content: {}, headers: {} };
      if (typeof rr.description === 'string') resp.description = rr.description;
      if (rr.schema !== undefined || rr.contentType !== undefined) {
        const media: HttpMediaType = {};
        if (rr.schema !== undefined)
          media.schema = normalizeSchema(rr.schema, joinPointer(rp, 'schema'), ctx.schemaCtx);
        resp.content[asString(rr.contentType) ?? 'application/json'] = media;
      }
      const rsrc = ctx.locate(rp);
      if (rsrc) resp.src = rsrc;
      op.responses[status] = resp;
    });
    operations.push(op);
  });
  const model: HttpContractModel = {
    kind: 'http',
    info: { title: asString(root.title), version: asString(root.version) },
    servers: (Array.isArray(root.servers) ? root.servers : [])
      .filter((s): s is string => typeof s === 'string')
      .map((url) => ({ url })),
    operations: operations.sort((a, b) => a.key.localeCompare(b.key)),
    securitySchemes,
    evidence: 'manual',
  };
  return finishContract(ctx, {
    protocol: 'manual-rest',
    formatVersion: '1.0',
    title: model.info.title,
    version: model.info.version,
    model,
    stats: {
      operations: operations.length,
      schemas: isObject(root.schemas) ? Object.keys(root.schemas).length : 0,
    },
  });
}
