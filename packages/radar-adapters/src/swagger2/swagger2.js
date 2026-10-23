/** @import { HttpContractModel, HttpMediaType, HttpOperation, HttpParameter, HttpParamLocation, HttpResponse, NSchema, ParsedContract, SecuritySchemeDef } from '@jky/radar-core' */
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
} from '@jky/radar-core';

import { createAdapterContext, error, finishContract, resolveObject, warn } from '../common.js';
import { parseSecurity } from '../openapi/openapi.js';

const METHODS = /** @type {const} */ (['get', 'put', 'post', 'delete', 'options', 'head', 'patch']);

/** Keywords of a non-body Swagger parameter that form its inline schema. */
const PARAM_SCHEMA_KEYS = [
  'type',
  'format',
  'items',
  'enum',
  'default',
  'maximum',
  'exclusiveMaximum',
  'minimum',
  'exclusiveMinimum',
  'maxLength',
  'minLength',
  'pattern',
  'maxItems',
  'minItems',
  'uniqueItems',
  'multipleOf',
  'x-nullable',
];

/** @type {Record<string, { style: string; explode: boolean }>} */
const COLLECTION_FORMAT_STYLE = {
  csv: { style: 'form', explode: false },
  multi: { style: 'form', explode: true },
  ssv: { style: 'spaceDelimited', explode: false },
  pipes: { style: 'pipeDelimited', explode: false },
};

/**
 * @param {StructuredDocument} doc
 * @returns {ParsedContract<HttpContractModel>}
 */
export function parseSwagger2(doc) {
  const root = /** @type {Record<string, unknown>} */ (doc.value);
  const ctx = createAdapterContext(doc, 'swagger2');
  if (String(root.swagger) !== '2.0')
    error(
      ctx,
      'UNSUPPORTED_VERSION',
      `swagger: "${String(root.swagger)}" is not supported (expected "2.0").`,
      '/swagger',
    );
  if (!isObject(root.info)) error(ctx, 'MISSING_INFO', 'The "info" object is required.', '');
  if (!isObject(root.paths)) error(ctx, 'MISSING_PATHS', '"paths" object is required.', '');

  const info = isObject(root.info) ? root.info : {};
  const rootConsumes = strList(root.consumes) ?? ['application/json'];
  const rootProduces = strList(root.produces) ?? ['application/json'];
  const rootSecurity = parseSecurity(root.security);

  // servers from host/basePath/schemes
  /** @type {HttpContractModel['servers']} */
  const servers = [];
  const basePath = typeof root.basePath === 'string' ? root.basePath : '';
  if (typeof root.host === 'string' || basePath) {
    const schemes = strList(root.schemes) ?? (typeof root.host === 'string' ? ['https'] : ['']);
    for (const s of schemes) {
      const url = typeof root.host === 'string' ? `${s}://${root.host}${basePath}` : basePath;
      const src = ctx.locate('/host') ?? ctx.locate('/basePath');
      servers.push(src ? { url, src } : { url });
    }
  }

  /** @type {Record<string, SecuritySchemeDef>} */
  const securitySchemes = {};
  for (const [name, raw] of entries(root.securityDefinitions)) {
    if (!isObject(raw)) continue;
    const ptr = joinPointer('/securityDefinitions', name);
    /** @type {SecuritySchemeDef} */
    let def;
    if (raw.type === 'basic') def = { type: 'http', scheme: 'basic' };
    else if (raw.type === 'apiKey')
      def = { type: 'apiKey', in: asString(raw.in) ?? 'header', name: asString(raw.name) ?? '' };
    else if (raw.type === 'oauth2') {
      /** @type {Record<string, string>} */
      const flowMap = {
        implicit: 'implicit',
        password: 'password',
        application: 'clientCredentials',
        accessCode: 'authorizationCode',
      };
      def = { type: 'oauth2', flows: [flowMap[String(raw.flow)] ?? String(raw.flow)] };
    } else def = { type: String(raw.type) };
    const src = ctx.locate(ptr);
    if (src) def.src = src;
    securitySchemes[name] = def;
  }

  /** @type {HttpOperation[]} */
  const operations = [];
  const seen = /** @type {Map<string, string>} */ (new Map());
  for (const [path, rawItem] of entries(root.paths)) {
    if (path.startsWith('x-')) continue;
    const itemPtr = joinPointer('/paths', path);
    const norm = normalizePathTemplate(path);
    const clash = seen.get(norm);
    if (clash) {
      error(
        ctx,
        'DUPLICATE_PATH_TEMPLATE',
        `Paths "${clash}" and "${path}" are identical templates.`,
        itemPtr,
      );
      continue;
    }
    seen.set(norm, path);
    const r = resolveObject(ctx, rawItem, itemPtr);
    if (!r) continue;
    const item = r.value;
    const pathParamsRaw = Array.isArray(item.parameters) ? item.parameters : [];
    for (const m of METHODS) {
      const rawOp = item[m];
      if (!isObject(rawOp)) continue;
      const opPtr = joinPointer(r.pointer, m);
      const consumes = strList(rawOp.consumes) ?? rootConsumes;
      const produces = strList(rawOp.produces) ?? rootProduces;
      /** @type {HttpOperation} */
      const op = {
        key: operationKey(m, path),
        displayKey: `${m.toUpperCase()} ${path}`,
        method: m.toUpperCase(),
        path,
        normalizedPath: norm,
        deprecated: rawOp.deprecated === true,
        parameters: [],
        responses: {},
        security: parseSecurity(rawOp.security) ?? rootSecurity ?? [],
      };
      const src = ctx.locate(opPtr);
      if (src) op.src = src;
      if (typeof rawOp.operationId === 'string') op.operationId = rawOp.operationId;
      if (typeof rawOp.summary === 'string') op.summary = rawOp.summary;
      if (typeof rawOp.description === 'string') op.description = rawOp.description;

      // merge path-level + operation-level parameters
      const merged = /** @type {Map<string, { raw: Record<string, unknown>; ptr: string }>} */ (new Map());
      /**
       * @param {unknown[]} list
       * @param {string} base
       */
      const addParams = (list, base) =>
        list.forEach((p, i) => {
          const pr = resolveObject(ctx, p, joinPointer(base, i));
          if (!pr) return;
          merged.set(`${String(pr.value.in)}:${String(pr.value.name)}`, { raw: pr.value, ptr: pr.pointer });
        });
      addParams(pathParamsRaw, joinPointer(r.pointer, 'parameters'));
      addParams(Array.isArray(rawOp.parameters) ? rawOp.parameters : [], joinPointer(opPtr, 'parameters'));

      /** @type {Array<{ raw: Record<string, unknown>; ptr: string }>} */
      const formFields = [];
      for (const { raw, ptr } of merged.values()) {
        const loc = String(raw.in);
        const name = String(raw.name ?? '');
        if (loc === 'body') {
          /** @type {Record<string, HttpMediaType>} */
          const content = {};
          for (const mt of consumes) {
            /** @type {HttpMediaType} */
            const media = {};
            if (raw.schema !== undefined)
              media.schema = normalizeSchema(raw.schema, joinPointer(ptr, 'schema'), ctx.schemaCtx);
            const msrc = ctx.locate(ptr);
            if (msrc) media.src = msrc;
            content[mt] = media;
          }
          op.requestBody = { required: raw.required === true, content };
          const bsrc = ctx.locate(ptr);
          if (bsrc) op.requestBody.src = bsrc;
          continue;
        }
        if (loc === 'formData') {
          formFields.push({ raw, ptr });
          continue;
        }
        if (!['path', 'query', 'header'].includes(loc)) {
          error(ctx, 'INVALID_PARAMETER', `Parameter "${name}" has invalid "in": ${loc}.`, ptr);
          continue;
        }
        if (loc === 'header' && ['accept', 'content-type', 'authorization'].includes(name.toLowerCase()))
          continue;
        /** @type {HttpParameter} */
        const param = {
          name,
          in: /** @type {HttpParamLocation} */ (loc),
          required: loc === 'path' ? true : raw.required === true,
          deprecated: false,
          schema: inlineParamSchema(ctx, raw, ptr),
        };
        const cf =
          typeof raw.collectionFormat === 'string'
            ? raw.collectionFormat
            : raw.type === 'array'
              ? 'csv'
              : undefined;
        if (cf) {
          const mapped = COLLECTION_FORMAT_STYLE[cf];
          if (mapped) {
            param.style = loc === 'query' ? mapped.style : 'simple';
            param.explode = mapped.explode;
          } else {
            warn(
              ctx,
              'COLLECTION_FORMAT_LOSSY',
              `collectionFormat "${cf}" on "${name}" has no OpenAPI 3 equivalent.`,
              ptr,
            );
            ctx.ignored.add(`collectionFormat ${cf}`);
          }
        }
        if (typeof raw.description === 'string') param.description = raw.description;
        const psrc = ctx.locate(ptr);
        if (psrc) param.src = psrc;
        op.parameters.push(param);
      }
      if (formFields.length > 0) {
        if (op.requestBody)
          error(ctx, 'BODY_AND_FORMDATA', `${op.displayKey} mixes "body" and "formData" parameters.`, opPtr);
        const hasFile = formFields.some((f) => f.raw.type === 'file');
        const mts = consumes.filter((c) => /multipart\/form-data|application\/x-www-form-urlencoded/.test(c));
        const mediaTypes = mts.length
          ? mts
          : [hasFile ? 'multipart/form-data' : 'application/x-www-form-urlencoded'];
        const objectSchema = buildFormSchema(ctx, formFields, joinPointer(opPtr, 'parameters'));
        /** @type {Record<string, HttpMediaType>} */
        const content = {};
        for (const mt of mediaTypes) content[mt] = { schema: objectSchema };
        op.requestBody = { required: formFields.some((f) => f.raw.required === true), content };
        warn(
          ctx,
          'FORMDATA_CONVERTED',
          `${op.displayKey}: formData parameters were converted to a ${mediaTypes.join('/')} request body schema.`,
          opPtr,
          'info',
        );
      }
      op.parameters.sort((a, b) => `${a.in}:${a.name}`.localeCompare(`${b.in}:${b.name}`));

      for (const [status, rawResp] of entries(rawOp.responses)) {
        if (status.startsWith('x-')) continue;
        const rPtr = joinPointer(opPtr, 'responses', status);
        const rr = resolveObject(ctx, rawResp, rPtr);
        if (!rr) continue;
        /** @type {HttpResponse} */
        const resp = { status: status.toUpperCase(), content: {}, headers: {} };
        if (typeof rr.value.description === 'string') resp.description = rr.value.description;
        if (rr.value.schema !== undefined) {
          const schema = normalizeSchema(rr.value.schema, joinPointer(rr.pointer, 'schema'), ctx.schemaCtx);
          for (const mt of produces) resp.content[mt] = { schema };
        }
        for (const [h, rawH] of entries(rr.value.headers)) {
          if (!isObject(rawH)) continue;
          const hp = joinPointer(rr.pointer, 'headers', h);
          /** @type {HttpResponse['headers'][string]} */
          const header = {
            required: false,
            schema: inlineParamSchema(ctx, rawH, hp),
          };
          const hsrc = ctx.locate(hp);
          if (hsrc) header.src = hsrc;
          resp.headers[h] = header;
        }
        if (rr.value.examples !== undefined) ctx.ignored.add('Response examples');
        const rsrc = ctx.locate(rr.pointer);
        if (rsrc) resp.src = rsrc;
        op.responses[resp.status] = resp;
      }
      operations.push(op);
    }
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
  return finishContract(ctx, {
    protocol: 'swagger2',
    formatVersion: '2.0',
    title: model.info.title,
    version: model.info.version,
    model,
    stats: {
      paths: seen.size,
      operations: operations.length,
      schemas: isObject(root.definitions) ? Object.keys(root.definitions).length : 0,
      securitySchemes: Object.keys(securitySchemes).length,
    },
  });
}

/**
 * @param {unknown} v
 * @returns {string[] | undefined}
 */
function strList(v) {
  return Array.isArray(v) && v.length > 0
    ? v.filter(/** @returns {x is string} */ (x) => typeof x === 'string')
    : undefined;
}

/**
 * @param {AdapterContext} ctx
 * @param {Record<string, unknown>} raw
 * @param {string} ptr
 * @returns {NSchema}
 */
function inlineParamSchema(ctx, raw, ptr) {
  // Build a synthetic schema object from the parameter's own keywords; pointers stay on the parameter.
  /** @type {Record<string, unknown>} */
  const synthetic = {};
  for (const k of PARAM_SCHEMA_KEYS) if (k in raw) synthetic[k] = raw[k];
  return normalizeSchema(synthetic, ptr, ctx.schemaCtx);
}

/**
 * @param {AdapterContext} ctx
 * @param {Array<{ raw: Record<string, unknown>; ptr: string }>} fields
 * @param {string} basePtr
 * @returns {NSchema}
 */
function buildFormSchema(ctx, fields, basePtr) {
  /** @type {Record<string, NSchema>} */
  const props = {};
  /** @type {string[]} */
  const required = [];
  for (const f of fields) {
    const name = String(f.raw.name);
    props[name] = inlineParamSchema(ctx, f.raw, f.ptr);
    if (f.raw.required === true) required.push(name);
  }
  const src = ctx.locate(basePtr);
  /** @type {NSchema} */
  const schema = {
    id: `${basePtr}#formData`,
    types: ['object'],
    properties: props,
    required: required.sort(),
    constraints: {},
    combinators: {},
    unsupported: {},
  };
  if (src) schema.src = src;
  return schema;
}
