/** @import { FindingEmitter, HttpContractModel, HttpOperation, ParsedContract, SourceRef } from '@jky/radar-core' */
/** @import { StructuredDocument } from '../parse/structured.js' */
/** @import { AdapterContext } from '../common.js' */

import { isObject, joinPointer, normalizePathTemplate, operationKey } from '@jky/radar-core';

import { createAdapterContext, error, finishContract, warn } from '../common.js';

/**
 * @typedef {Object} PostmanRequest
 * @property {string} id
 * @property {string} name
 * @property {string} folder
 * @property {string} method
 * @property {string} path - Path template with {{vars}} and :params normalised to {param}.
 * @property {string} normalizedPath
 * @property {string} rawUrl
 * @property {string[]} query
 * @property {string[]} headers
 * @property {string[]} variables
 * @property {string | null} bodyMode
 * @property {string[] | null} bodyFields
 * @property {string} authType
 * @property {boolean} hasScripts
 * @property {SourceRef} [src]
 */

/**
 * @typedef {Object} PostmanModel
 * @property {'postman'} kind
 * @property {string} [name]
 * @property {PostmanRequest[]} requests
 */

const VAR = /\{\{\s*([^{}\s]+)\s*\}\}/g;
const MAX_ITEMS = 5_000;

/**
 * @param {StructuredDocument} doc
 * @returns {ParsedContract<PostmanModel>}
 */
export function parsePostman2(doc) {
  const root = /** @type {Record<string, unknown>} */ (doc.value);
  const ctx = createAdapterContext(doc, 'draft7');
  const info = isObject(root.info) ? root.info : {};
  if (!Array.isArray(root.item))
    error(ctx, 'MISSING_ITEMS', 'A Postman collection must contain an "item" array.', '');
  const schema = typeof info.schema === 'string' ? info.schema : '';
  if (/v2\.0/.test(schema))
    warn(ctx, 'POSTMAN_V20', 'Postman v2.0 collection parsed with v2.1 rules.', '/info/schema');

  ctx.ignored.add('Response examples (not authoritative schemas)');
  /** @type {PostmanRequest[]} */
  const requests = [];
  const collectionAuth = authType(root.auth);
  let count = 0;
  let scripts = false;

  /**
   * @param {unknown} items
   * @param {string} ptr
   * @param {string} folder
   * @param {string} inheritedAuth
   * @param {number} depth
   */
  const walk = (items, ptr, folder, inheritedAuth, depth) => {
    if (!Array.isArray(items)) return;
    if (depth > 32) return void error(ctx, 'MAX_DEPTH', 'Folder nesting deeper than 32 levels.', ptr);
    items.forEach((it, i) => {
      const ip = joinPointer(ptr, i);
      if (!isObject(it)) return;
      if (++count > MAX_ITEMS)
        return void (
          count === MAX_ITEMS + 1 &&
          error(ctx, 'TOO_MANY_ITEMS', `More than ${MAX_ITEMS} collection items.`, ip)
        );
      if (Array.isArray(it.event) && it.event.length > 0) scripts = true;
      const name = typeof it.name === 'string' ? it.name : `item ${i + 1}`;
      const auth = it.auth === undefined ? inheritedAuth : authType(it.auth);
      if (Array.isArray(it.item)) {
        walk(it.item, joinPointer(ip, 'item'), folder ? `${folder}/${name}` : name, auth, depth + 1);
        return;
      }
      if (it.request === undefined) return;
      const req = parseRequest(ctx, it.request, joinPointer(ip, 'request'), name, folder, auth);
      if (req) requests.push(req);
    });
  };
  walk(root.item, '/item', '', collectionAuth, 0);
  if (Array.isArray(root.event) && root.event.length > 0) scripts = true;
  if (scripts) {
    ctx.ignored.add('Pre-request and test scripts (never executed)');
    warn(
      ctx,
      'SCRIPTS_IGNORED',
      'Collection scripts were detected and ignored; JKY-Radar never executes scripts.',
      '',
      'info',
    );
  }

  // disambiguate duplicate names
  const counts = /** @type {Map<string, number>} */ (new Map());
  for (const r of requests) {
    const n = (counts.get(r.id) ?? 0) + 1;
    counts.set(r.id, n);
    if (n > 1) r.id = `${r.id} #${n}`;
  }

  const name = typeof info.name === 'string' ? info.name : undefined;
  return finishContract(ctx, {
    protocol: 'postman2',
    formatVersion: /v2\.0/.test(schema) ? '2.0.0' : '2.1.0',
    title: name,
    model: { kind: 'postman', name, requests },
    stats: { requests: requests.length, folders: new Set(requests.map((r) => r.folder)).size },
  });
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function authType(raw) {
  if (!isObject(raw)) return 'none';
  return typeof raw.type === 'string' ? raw.type : 'none';
}

/**
 * @param {AdapterContext} ctx
 * @param {unknown} raw
 * @param {string} ptr
 * @param {string} name
 * @param {string} folder
 * @param {string} auth
 * @returns {PostmanRequest | undefined}
 */
function parseRequest(ctx, raw, ptr, name, folder, auth) {
  let method = 'GET';
  /** @type {unknown} */
  let url;
  /** @type {unknown} */
  let header;
  /** @type {unknown} */
  let body;
  let reqAuth = auth;
  if (typeof raw === 'string') url = raw;
  else if (isObject(raw)) {
    method = typeof raw.method === 'string' ? raw.method.toUpperCase() : 'GET';
    url = raw.url;
    header = raw.header;
    body = raw.body;
    if (raw.auth !== undefined) reqAuth = authType(raw.auth);
  } else return undefined;

  const vars = /** @type {Set<string>} */ (new Set());
  /** @param {string} s */
  const collectVars = (s) => {
    for (const m of s.matchAll(VAR)) vars.add(m[1]);
  };
  let rawUrl = '';
  /** @type {string[]} */
  let pathSegs = [];
  /** @type {string[]} */
  let query = [];
  if (typeof url === 'string') {
    rawUrl = url;
    collectVars(url);
    const parsed = splitRawUrl(url);
    pathSegs = parsed.path;
    query = parsed.query;
  } else if (isObject(url)) {
    rawUrl = typeof url.raw === 'string' ? url.raw : '';
    collectVars(rawUrl);
    if (Array.isArray(url.path)) {
      pathSegs = url.path.map((s) =>
        typeof s === 'string' ? s : isObject(s) && typeof s.value === 'string' ? s.value : '',
      );
    } else if (typeof url.path === 'string') pathSegs = url.path.split('/').filter(Boolean);
    else pathSegs = splitRawUrl(rawUrl).path;
    if (Array.isArray(url.query)) {
      query = url.query
        .filter((q) => isObject(q) && q.disabled !== true && typeof q.key === 'string')
        .map((q) => String(/** @type {Record<string, unknown>} */ (q).key));
      for (const q of url.query) if (isObject(q) && typeof q.value === 'string') collectVars(q.value);
    } else query = splitRawUrl(rawUrl).query;
  }
  const path = `/${pathSegs
    .filter((s) => s !== '')
    .map((s) => {
      const m = /^\{\{\s*([^}]+)\s*\}\}$/.exec(s) ?? /^:([A-Za-z_][\w]*)$/.exec(s);
      return m ? `{${m[1]}}` : s;
    })
    .join('/')}`;
  /** @type {string[]} */
  const headers = [];
  if (Array.isArray(header)) {
    for (const h of header) {
      if (!isObject(h) || h.disabled === true || typeof h.key !== 'string') continue;
      headers.push(h.key.toLowerCase());
      if (typeof h.value === 'string') collectVars(h.value);
    }
  }
  /** @type {string | null} */
  let bodyMode = null;
  /** @type {string[] | null} */
  let bodyFields = null;
  if (isObject(body) && typeof body.mode === 'string') {
    const lang =
      isObject(body.options) && isObject(body.options.raw) && typeof body.options.raw.language === 'string'
        ? `:${body.options.raw.language}`
        : '';
    bodyMode = `${body.mode}${body.mode === 'raw' ? lang : ''}`;
    if (body.mode === 'raw' && typeof body.raw === 'string') {
      collectVars(body.raw);
      bodyFields = jsonFieldPaths(body.raw);
    } else if ((body.mode === 'formdata' || body.mode === 'urlencoded') && Array.isArray(body[body.mode])) {
      bodyFields = /** @type {unknown[]} */ (body[body.mode])
        .filter((f) => isObject(f) && f.disabled !== true && typeof f.key === 'string')
        .map((f) => String(/** @type {Record<string, unknown>} */ (f).key))
        .sort();
    } else if (body.mode === 'graphql') ctx.ignored.add('GraphQL request bodies in collections');
  }
  /** @type {PostmanRequest} */
  const req = {
    id: folder ? `${folder}/${name}` : name,
    name,
    folder,
    method,
    path,
    normalizedPath: normalizePathTemplate(path),
    rawUrl,
    query: [...new Set(query)].sort(),
    headers: [...new Set(headers)].sort(),
    variables: [...vars].sort(),
    bodyMode,
    bodyFields,
    authType: reqAuth,
    hasScripts: false,
  };
  const src = ctx.locate(ptr);
  if (src) req.src = src;
  return req;
}

/**
 * @param {string} raw
 * @returns {{ path: string[]; query: string[] }}
 */
function splitRawUrl(raw) {
  let rest = raw.trim();
  const qIdx = rest.indexOf('?');
  const qs = qIdx >= 0 ? rest.slice(qIdx + 1) : '';
  if (qIdx >= 0) rest = rest.slice(0, qIdx);
  rest = rest.replace(/^[a-z]+:\/\//i, '');
  // drop host (first segment) — may be {{baseUrl}} or a hostname
  const segs = rest.split('/');
  segs.shift();
  return {
    path: segs.filter(Boolean),
    query: qs
      .split('&')
      .map((p) => p.split('=')[0] ?? '')
      .filter(Boolean),
  };
}

/**
 * Key paths of an example JSON body ("customer.email", "items[].sku"); null if not JSON.
 * @param {string} raw
 * @returns {string[] | null}
 */
function jsonFieldPaths(raw) {
  if (raw.length > 200_000) return null;
  /** @type {unknown} */
  let v;
  try {
    v = JSON.parse(raw.replace(VAR, '0'));
  } catch {
    return null;
  }
  const out = /** @type {Set<string>} */ (new Set());
  /**
   * @param {unknown} x
   * @param {string} prefix
   * @param {number} depth
   */
  const walk = (x, prefix, depth) => {
    if (depth > 12 || out.size > 2000) return;
    if (Array.isArray(x)) {
      if (x.length > 0) walk(x[0], `${prefix}[]`, depth + 1);
      return;
    }
    if (isObject(x)) {
      for (const [k, val] of Object.entries(x)) {
        const p = prefix ? `${prefix}.${k}` : k;
        out.add(p);
        walk(val, p, depth + 1);
      }
    }
  };
  walk(v, '', 0);
  return [...out].sort();
}

/* ------------------------------------------------------------------ */
/* Same-protocol differ                                                */
/* ------------------------------------------------------------------ */

/**
 * @param {PostmanModel} a
 * @param {PostmanModel} b
 * @param {FindingEmitter} emitter
 * @returns {void}
 */
export function diffPostman(a, b, emitter) {
  const byId = new Map(b.requests.map((r) => [r.id, r]));
  const used = /** @type {Set<string>} */ (new Set());
  /** @type {Array<[PostmanRequest, PostmanRequest]>} */
  const pairs = [];
  /** @type {PostmanRequest[]} */
  const leftover = [];
  for (const r of a.requests) {
    const m = byId.get(r.id);
    if (m) {
      pairs.push([r, m]);
      used.add(m.id);
    } else leftover.push(r);
  }
  // second pass: reorganised/renamed requests matched by method + path
  for (const r of leftover) {
    const m = b.requests.find(
      (x) => !used.has(x.id) && x.method === r.method && x.normalizedPath === r.normalizedPath,
    );
    if (m) {
      pairs.push([r, m]);
      used.add(m.id);
      continue;
    }
    emitter.emit('POSTMAN_REQUEST_REMOVED', {
      logicalPath: `${r.id}`,
      entityKey: operationKey(r.method, r.path),
      message: `Request "${r.id}" (${r.method} ${r.path}) is no longer in the collection.`,
      before: `${r.method} ${r.path}`,
      ...(r.src ? { baselineSource: r.src } : {}),
    });
  }
  for (const r of b.requests) {
    if (used.has(r.id)) continue;
    emitter.emit('POSTMAN_REQUEST_ADDED', {
      logicalPath: r.id,
      entityKey: operationKey(r.method, r.path),
      message: `Request "${r.id}" (${r.method} ${r.path}) was added.`,
      after: `${r.method} ${r.path}`,
      ...(r.src ? { candidateSource: r.src } : {}),
    });
  }
  for (const [o, n] of pairs) {
    const base = {
      entityKey: operationKey(o.method, o.path),
      ...(o.src ? { baselineSource: o.src } : {}),
      ...(n.src ? { candidateSource: n.src } : {}),
    };
    const lp = n.id;
    if (o.method !== n.method) {
      emitter.emit('POSTMAN_REQUEST_METHOD_CHANGED', {
        ...base,
        logicalPath: lp,
        message: `"${n.id}" changed method from ${o.method} to ${n.method}.`,
        before: o.method,
        after: n.method,
      });
    }
    if (o.normalizedPath !== n.normalizedPath) {
      emitter.emit('POSTMAN_REQUEST_URL_CHANGED', {
        ...base,
        logicalPath: lp,
        message: `"${n.id}" path changed from ${o.path} to ${n.path}.`,
        before: o.path,
        after: n.path,
      });
    }
    /**
     * @param {string[]} x
     * @param {string[]} y
     */
    const diffSet = (x, y) => ({
      removed: x.filter((k) => !y.includes(k)),
      added: y.filter((k) => !x.includes(k)),
    });
    const q = diffSet(o.query, n.query);
    for (const k of q.removed)
      emitter.emit('POSTMAN_QUERY_PARAM_REMOVED', {
        ...base,
        logicalPath: `${lp} › query ${k}`,
        message: `Query parameter "${k}" is no longer sent.`,
        before: k,
      });
    for (const k of q.added)
      emitter.emit('POSTMAN_QUERY_PARAM_ADDED', {
        ...base,
        logicalPath: `${lp} › query ${k}`,
        message: `Query parameter "${k}" is now sent.`,
        after: k,
      });
    const h = diffSet(o.headers, n.headers);
    for (const k of h.removed)
      emitter.emit('POSTMAN_HEADER_REMOVED', {
        ...base,
        logicalPath: `${lp} › header ${k}`,
        message: `Header "${k}" is no longer sent.`,
        before: k,
      });
    for (const k of h.added)
      emitter.emit('POSTMAN_HEADER_ADDED', {
        ...base,
        logicalPath: `${lp} › header ${k}`,
        message: `Header "${k}" is now sent.`,
        after: k,
      });
    const v = diffSet(o.variables, n.variables);
    if (v.removed.length > 0 && v.added.length > 0) {
      emitter.emit('POSTMAN_VARIABLE_RENAMED', {
        ...base,
        logicalPath: `${lp} › variables`,
        message: `Variable reference(s) {{${v.removed.join('}}, {{')}}} replaced by {{${v.added.join('}}, {{')}}}.`,
        before: v.removed,
        after: v.added,
      });
    }
    if (o.bodyMode !== n.bodyMode && (o.bodyMode || n.bodyMode)) {
      emitter.emit('POSTMAN_BODY_MODE_CHANGED', {
        ...base,
        logicalPath: `${lp} › body`,
        message: `Body mode changed from ${o.bodyMode ?? 'none'} to ${n.bodyMode ?? 'none'}.`,
        before: o.bodyMode,
        after: n.bodyMode,
      });
    } else if (o.bodyFields && n.bodyFields) {
      const f = diffSet(o.bodyFields, n.bodyFields);
      if (f.removed.length || f.added.length) {
        emitter.emit('POSTMAN_BODY_FIELDS_CHANGED', {
          ...base,
          logicalPath: `${lp} › body`,
          message: `Example body fields changed${f.removed.length ? `; removed: ${f.removed.join(', ')}` : ''}${f.added.length ? `; added: ${f.added.join(', ')}` : ''}.`,
          before: f.removed,
          after: f.added,
        });
      }
    }
    if (o.authType !== n.authType) {
      emitter.emit('POSTMAN_AUTH_CHANGED', {
        ...base,
        logicalPath: `${lp} › auth`,
        message: `Auth type changed from ${o.authType} to ${n.authType}.`,
        before: o.authType,
        after: n.authType,
      });
    }
  }
}

/**
 * Project a Postman collection into the canonical HTTP model (cross-format comparisons only).
 * @param {PostmanModel} m
 * @returns {HttpContractModel}
 */
export function projectPostmanToHttp(m) {
  const ops = /** @type {Map<string, HttpOperation>} */ (new Map());
  for (const r of m.requests) {
    const key = operationKey(r.method, r.path);
    if (ops.has(key)) continue;
    /** @type {HttpOperation} */
    const op = {
      key,
      displayKey: `${r.method} ${r.path}`,
      method: r.method,
      path: r.path,
      normalizedPath: r.normalizedPath,
      deprecated: false,
      parameters: [
        ...r.query.map((q) => ({
          name: q,
          in: /** @type {const} */ ('query'),
          required: false,
          deprecated: false,
        })),
        ...[...r.path.matchAll(/\{([^}]+)\}/g)].map((x) => ({
          name: x[1],
          in: /** @type {const} */ ('path'),
          required: true,
          deprecated: false,
        })),
      ],
      responses: {},
      security: null,
    };
    if (r.src) op.src = r.src;
    ops.set(key, op);
  }
  return {
    kind: 'http',
    info: { title: m.name },
    servers: [],
    operations: [...ops.values()],
    securitySchemes: {},
    evidence: 'collection',
  };
}
