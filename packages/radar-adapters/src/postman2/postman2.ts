import type {
  FindingEmitter,
  HttpContractModel,
  HttpOperation,
  ParsedContract,
  SourceRef,
} from '@jky/radar-core';
import { isObject, joinPointer, normalizePathTemplate, operationKey } from '@jky/radar-core';
import type { StructuredDocument } from '../parse/structured.js';
import { createAdapterContext, error, finishContract, warn, type AdapterContext } from '../common.js';

export interface PostmanRequest {
  id: string;
  name: string;
  folder: string;
  method: string;
  /** Path template with {{vars}} and :params normalised to {param}. */
  path: string;
  normalizedPath: string;
  rawUrl: string;
  query: string[];
  headers: string[];
  variables: string[];
  bodyMode: string | null;
  bodyFields: string[] | null;
  authType: string;
  hasScripts: boolean;
  src?: SourceRef;
}

export interface PostmanModel {
  kind: 'postman';
  name?: string;
  requests: PostmanRequest[];
}

const VAR = /\{\{\s*([^{}\s]+)\s*\}\}/g;
const MAX_ITEMS = 5_000;

export function parsePostman2(doc: StructuredDocument): ParsedContract<PostmanModel> {
  const root = doc.value as Record<string, unknown>;
  const ctx = createAdapterContext(doc, 'draft7');
  const info = isObject(root.info) ? root.info : {};
  if (!Array.isArray(root.item))
    error(ctx, 'MISSING_ITEMS', 'A Postman collection must contain an "item" array.', '');
  const schema = typeof info.schema === 'string' ? info.schema : '';
  if (/v2\.0/.test(schema))
    warn(ctx, 'POSTMAN_V20', 'Postman v2.0 collection parsed with v2.1 rules.', '/info/schema');

  ctx.ignored.add('Response examples (not authoritative schemas)');
  const requests: PostmanRequest[] = [];
  const collectionAuth = authType(root.auth);
  let count = 0;
  let scripts = false;

  const walk = (items: unknown, ptr: string, folder: string, inheritedAuth: string, depth: number) => {
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
  const counts = new Map<string, number>();
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

function authType(raw: unknown): string {
  if (!isObject(raw)) return 'none';
  return typeof raw.type === 'string' ? raw.type : 'none';
}

function parseRequest(
  ctx: AdapterContext,
  raw: unknown,
  ptr: string,
  name: string,
  folder: string,
  auth: string,
): PostmanRequest | undefined {
  let method = 'GET';
  let url: unknown;
  let header: unknown;
  let body: unknown;
  let reqAuth = auth;
  if (typeof raw === 'string') url = raw;
  else if (isObject(raw)) {
    method = typeof raw.method === 'string' ? raw.method.toUpperCase() : 'GET';
    url = raw.url;
    header = raw.header;
    body = raw.body;
    if (raw.auth !== undefined) reqAuth = authType(raw.auth);
  } else return undefined;

  const vars = new Set<string>();
  const collectVars = (s: string) => {
    for (const m of s.matchAll(VAR)) vars.add(m[1]!);
  };
  let rawUrl = '';
  let pathSegs: string[] = [];
  let query: string[] = [];
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
        .map((q) => String((q as Record<string, unknown>).key));
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
  const headers: string[] = [];
  if (Array.isArray(header)) {
    for (const h of header) {
      if (!isObject(h) || h.disabled === true || typeof h.key !== 'string') continue;
      headers.push(h.key.toLowerCase());
      if (typeof h.value === 'string') collectVars(h.value);
    }
  }
  let bodyMode: string | null = null;
  let bodyFields: string[] | null = null;
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
      bodyFields = (body[body.mode] as unknown[])
        .filter((f) => isObject(f) && f.disabled !== true && typeof f.key === 'string')
        .map((f) => String((f as Record<string, unknown>).key))
        .sort();
    } else if (body.mode === 'graphql') ctx.ignored.add('GraphQL request bodies in collections');
  }
  const req: PostmanRequest = {
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

function splitRawUrl(raw: string): { path: string[]; query: string[] } {
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

/** Key paths of an example JSON body ("customer.email", "items[].sku"); null if not JSON. */
function jsonFieldPaths(raw: string): string[] | null {
  if (raw.length > 200_000) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw.replace(VAR, '0'));
  } catch {
    return null;
  }
  const out = new Set<string>();
  const walk = (x: unknown, prefix: string, depth: number) => {
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

export function diffPostman(a: PostmanModel, b: PostmanModel, emitter: FindingEmitter): void {
  const byId = new Map(b.requests.map((r) => [r.id, r]));
  const used = new Set<string>();
  const pairs: Array<[PostmanRequest, PostmanRequest]> = [];
  const leftover: PostmanRequest[] = [];
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
    const diffSet = (x: string[], y: string[]) => ({
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

/** Project a Postman collection into the canonical HTTP model (cross-format comparisons only). */
export function projectPostmanToHttp(m: PostmanModel): HttpContractModel {
  const ops = new Map<string, HttpOperation>();
  for (const r of m.requests) {
    const key = operationKey(r.method, r.path);
    if (ops.has(key)) continue;
    const op: HttpOperation = {
      key,
      displayKey: `${r.method} ${r.path}`,
      method: r.method,
      path: r.path,
      normalizedPath: r.normalizedPath,
      deprecated: false,
      parameters: [
        ...r.query.map((q) => ({ name: q, in: 'query' as const, required: false, deprecated: false })),
        ...[...r.path.matchAll(/\{([^}]+)\}/g)].map((x) => ({
          name: x[1]!,
          in: 'path' as const,
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
