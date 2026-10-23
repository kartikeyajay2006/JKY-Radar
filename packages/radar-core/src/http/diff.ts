import type {
  HttpContractModel,
  HttpMediaType,
  HttpOperation,
  HttpParameter,
  HttpResponse,
  SecurityRequirement,
  SecuritySchemeDef,
} from '../domain/models.js';
import type { SourceRef } from '../domain/types.js';
import type { FindingEmitter } from '../rules/emitter.js';
import { SchemaComparator } from '../schema/compare.js';

export interface HttpDiffOptions {
  operationAliases?: Record<string, string>;
}

const srcs = (o?: { src?: SourceRef }, n?: { src?: SourceRef }) => {
  const r: { baselineSource?: SourceRef; candidateSource?: SourceRef } = {};
  if (o?.src) r.baselineSource = o.src;
  if (n?.src) r.candidateSource = n.src;
  return r;
};

/** Normalise a path template so "/orders/{id}" and "/orders/{orderId}" match. */
export function normalizePathTemplate(path: string): string {
  let p = path.trim();
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+/g, '/');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.replace(/\{[^}]*\}/g, '{}').replace(/:([A-Za-z_][\w]*)/g, '{}');
}

export function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizePathTemplate(path)}`;
}

export function pathParamNames(path: string): string[] {
  return [...path.matchAll(/\{([^}]*)\}/g)].map((m) => m[1] ?? '');
}

export function normalizeMediaType(mt: string): string {
  return mt.split(';')[0]!.trim().toLowerCase();
}

const isSuccess = (status: string) => /^[123]/.test(status);

function statusCovers(range: string, status: string): boolean {
  return /^[1-5]XX$/i.test(range) && range[0] === status[0];
}

export function diffHttp(
  oldC: HttpContractModel,
  newC: HttpContractModel,
  emitter: FindingEmitter,
  opts: HttpDiffOptions = {},
): void {
  const cmp = new SchemaComparator();

  if (oldC.info.version !== newC.info.version && oldC.info.version && newC.info.version) {
    emitter.emit('HTTP_INFO_VERSION_CHANGED', {
      logicalPath: 'info.version',
      message: `API version label changed from ${oldC.info.version} to ${newC.info.version}.`,
      before: oldC.info.version,
      after: newC.info.version,
    });
  }

  // ---- servers ------------------------------------------------------------
  const oldServers = new Map(oldC.servers.map((s) => [s.url, s]));
  const newServers = new Map(newC.servers.map((s) => [s.url, s]));
  for (const [url, s] of oldServers) {
    if (!newServers.has(url)) {
      emitter.emit('HTTP_SERVER_REMOVED', {
        logicalPath: `servers › ${url}`,
        message: `Server ${url} is no longer listed.`,
        before: url,
        ...srcs(s, undefined),
      });
    }
  }
  for (const [url, s] of newServers) {
    if (!oldServers.has(url) && oldServers.size > 0) {
      emitter.emit('HTTP_SERVER_ADDED', {
        logicalPath: `servers › ${url}`,
        message: `Server ${url} was added.`,
        after: url,
        ...srcs(undefined, s),
      });
    }
  }

  // ---- security scheme definitions ---------------------------------------
  const usedSchemes = new Set<string>();
  for (const op of oldC.operations)
    for (const alt of op.security ?? []) Object.keys(alt).forEach((k) => usedSchemes.add(k));
  for (const name of [...usedSchemes].sort()) {
    const a = oldC.securitySchemes[name];
    const b = newC.securitySchemes[name];
    if (a && b && schemeSignature(a) !== schemeSignature(b)) {
      emitter.emit('HTTP_SECURITY_SCHEME_CHANGED', {
        logicalPath: `security scheme ${name}`,
        entityKey: `security:${name}`,
        message: `Security scheme "${name}" changed from ${schemeSignature(a)} to ${schemeSignature(b)}.`,
        before: schemeSignature(a),
        after: schemeSignature(b),
        ...srcs(a, b),
      });
    }
  }

  // ---- operation matching -------------------------------------------------
  const newByKey = new Map(newC.operations.map((op) => [op.key, op]));
  const aliases = new Map<string, string>();
  for (const [from, to] of Object.entries(opts.operationAliases ?? {})) {
    const [fm, ...fp] = from.split(' ');
    const [tm, ...tp] = to.split(' ');
    if (fm && tm) aliases.set(operationKey(fm, fp.join(' ')), operationKey(tm, tp.join(' ')));
  }

  const matched: Array<[HttpOperation, HttpOperation]> = [];
  const unmatchedOld: HttpOperation[] = [];
  const usedNew = new Set<string>();
  for (const op of oldC.operations) {
    const aliasTarget = aliases.get(op.key);
    const target = newByKey.get(aliasTarget ?? op.key);
    if (target && !usedNew.has(target.key)) {
      matched.push([op, target]);
      usedNew.add(target.key);
    } else unmatchedOld.push(op);
  }
  let unmatchedNew = newC.operations.filter((op) => !usedNew.has(op.key));

  // Moves: same operationId, different method or path.
  for (const op of [...unmatchedOld]) {
    let candidate: HttpOperation | undefined;
    if (op.operationId) candidate = unmatchedNew.find((n) => n.operationId === op.operationId);
    if (!candidate) {
      // method change on a path that had exactly one operation on both sides
      const oldOnPath = oldC.operations.filter((o) => o.normalizedPath === op.normalizedPath);
      const newOnPath = unmatchedNew.filter((n) => n.normalizedPath === op.normalizedPath);
      const newAllOnPath = newC.operations.filter((n) => n.normalizedPath === op.normalizedPath);
      if (oldOnPath.length === 1 && newAllOnPath.length === 1 && newOnPath.length === 1)
        candidate = newOnPath[0];
    }
    if (!candidate) continue;
    const methodChanged = candidate.method !== op.method;
    const pathChanged = candidate.normalizedPath !== op.normalizedPath;
    emitter.emit(pathChanged ? 'HTTP_OPERATION_PATH_CHANGED' : 'HTTP_OPERATION_METHOD_CHANGED', {
      logicalPath: op.displayKey,
      entityKey: op.key,
      message: pathChanged
        ? `Operation ${op.operationId ? `"${op.operationId}" ` : ''}moved from ${op.displayKey} to ${candidate.displayKey}.`
        : `Operation on ${op.path} changed method from ${op.method} to ${candidate.method}.`,
      before: op.displayKey,
      after: candidate.displayKey,
      ...srcs(op, candidate),
      ...(methodChanged && pathChanged ? { tags: ['method-changed'] } : {}),
    });
    matched.push([op, candidate]);
    unmatchedOld.splice(unmatchedOld.indexOf(op), 1);
    unmatchedNew = unmatchedNew.filter((n) => n !== candidate);
  }

  for (const op of unmatchedOld) {
    emitter.emit('HTTP_OPERATION_REMOVED', {
      logicalPath: op.displayKey,
      entityKey: op.key,
      message: `${op.displayKey}${op.operationId ? ` (operationId "${op.operationId}")` : ''} was removed.`,
      before: op.displayKey,
      ...srcs(op, undefined),
    });
  }
  for (const op of unmatchedNew) {
    emitter.emit('HTTP_OPERATION_ADDED', {
      logicalPath: op.displayKey,
      entityKey: op.key,
      message: `${op.displayKey} was added.`,
      after: op.displayKey,
      ...srcs(undefined, op),
    });
  }

  for (const [o, n] of matched) diffOperation(o, n, emitter, cmp, oldC, newC);
}

function schemeSignature(s: SecuritySchemeDef): string {
  const parts = [s.type];
  if (s.in) parts.push(`in=${s.in}`);
  if (s.name) parts.push(`name=${s.name.toLowerCase()}`);
  if (s.scheme) parts.push(`scheme=${s.scheme.toLowerCase()}`);
  return parts.join(' ');
}

function paramKey(p: HttpParameter, path: string): string {
  if (p.in === 'path') {
    const idx = pathParamNames(path).indexOf(p.name);
    return `path#${idx >= 0 ? idx : p.name}`;
  }
  return `${p.in}:${p.in === 'header' ? p.name.toLowerCase() : p.name}`;
}

const defaultStyle = (p: HttpParameter) =>
  p.style ?? (p.in === 'query' || p.in === 'cookie' ? 'form' : 'simple');
const defaultExplode = (p: HttpParameter) => p.explode ?? defaultStyle(p) === 'form';

function diffOperation(
  o: HttpOperation,
  n: HttpOperation,
  emitter: FindingEmitter,
  cmp: SchemaComparator,
  oldC: HttpContractModel,
  newC: HttpContractModel,
) {
  const op = n.displayKey;
  const entityKey = o.key;
  const e = (ruleId: string, input: Parameters<FindingEmitter['emit']>[1]) =>
    emitter.emit(ruleId, { entityKey, ...input });

  if (o.path !== n.path && o.normalizedPath === n.normalizedPath) {
    const a = pathParamNames(o.path);
    const b = pathParamNames(n.path);
    if (a.join('|') !== b.join('|')) {
      e('HTTP_PATH_PARAM_RENAMED', {
        logicalPath: op,
        message: `Path parameter(s) renamed: ${a.join(', ')} → ${b.join(', ')}.`,
        before: o.path,
        after: n.path,
        ...srcs(o, n),
      });
    }
  }
  if (!o.deprecated && n.deprecated) {
    e('HTTP_OPERATION_DEPRECATED', {
      logicalPath: op,
      message: `${op} is now deprecated.`,
      after: true,
      ...srcs(o, n),
    });
  }
  if (o.operationId && n.operationId && o.operationId !== n.operationId) {
    e('HTTP_OPERATION_ID_CHANGED', {
      logicalPath: op,
      message: `operationId changed from "${o.operationId}" to "${n.operationId}".`,
      before: o.operationId,
      after: n.operationId,
      ...srcs(o, n),
    });
  }
  if ((o.summary ?? '') !== (n.summary ?? '') || (o.description ?? '') !== (n.description ?? '')) {
    e('HTTP_DOCS_CHANGED', {
      logicalPath: op,
      message: `Summary/description of ${op} changed.`,
      before: { summary: o.summary, description: o.description },
      after: { summary: n.summary, description: n.description },
      ...srcs(o, n),
    });
  }

  // ---- parameters -----------------------------------------------------------
  const oParams = new Map(o.parameters.map((p) => [paramKey(p, o.path), p]));
  const nParams = new Map(n.parameters.map((p) => [paramKey(p, n.path), p]));
  for (const [k, p] of oParams) {
    const q = nParams.get(k);
    const label = `${op} › ${p.in} parameter "${q?.name ?? p.name}"`;
    if (!q) {
      e('HTTP_PARAM_REMOVED', {
        logicalPath: label,
        message: `${p.in} parameter "${p.name}" is no longer documented.`,
        before: p.name,
        ...srcs(p, undefined),
      });
      continue;
    }
    if (p.required !== q.required) {
      e(q.required ? 'HTTP_PARAM_BECAME_REQUIRED' : 'HTTP_PARAM_BECAME_OPTIONAL', {
        logicalPath: label,
        message: `${p.in} parameter "${p.name}" became ${q.required ? 'required' : 'optional'}.`,
        before: p.required ? 'required' : 'optional',
        after: q.required ? 'required' : 'optional',
        ...srcs(p, q),
      });
    }
    if (defaultStyle(p) !== defaultStyle(q) || defaultExplode(p) !== defaultExplode(q)) {
      e('HTTP_PARAM_STYLE_CHANGED', {
        logicalPath: label,
        message: `Serialisation of "${p.name}" changed from style=${defaultStyle(p)}, explode=${defaultExplode(p)} to style=${defaultStyle(q)}, explode=${defaultExplode(q)}.`,
        before: { style: defaultStyle(p), explode: defaultExplode(p) },
        after: { style: defaultStyle(q), explode: defaultExplode(q) },
        ...srcs(p, q),
      });
    }
    cmp.emitComparison(emitter, p.schema, q.schema, 'request', { logicalPath: label, entityKey });
  }
  for (const [k, q] of nParams) {
    if (oParams.has(k)) continue;
    e(q.required ? 'HTTP_PARAM_REQUIRED_ADDED' : 'HTTP_PARAM_OPTIONAL_ADDED', {
      logicalPath: `${op} › ${q.in} parameter "${q.name}"`,
      message: `New ${q.required ? 'required' : 'optional'} ${q.in} parameter "${q.name}".`,
      after: q.name,
      ...srcs(undefined, q),
    });
  }

  // ---- request body ---------------------------------------------------------
  const ob = o.requestBody;
  const nb = n.requestBody;
  const bodyLabel = `${op} › request body`;
  if (!ob && nb) {
    e(nb.required ? 'HTTP_REQUEST_BODY_REQUIRED_ADDED' : 'HTTP_REQUEST_BODY_OPTIONAL_ADDED', {
      logicalPath: bodyLabel,
      message: `${op} now ${nb.required ? 'requires' : 'accepts'} a request body (${Object.keys(nb.content).join(', ') || 'any media type'}).`,
      after: Object.keys(nb.content),
      ...srcs(undefined, nb),
    });
  } else if (ob && !nb) {
    e('HTTP_REQUEST_BODY_REMOVED', {
      logicalPath: bodyLabel,
      message: `${op} no longer documents a request body.`,
      before: Object.keys(ob.content),
      ...srcs(ob, undefined),
    });
  } else if (ob && nb) {
    if (!ob.required && nb.required) {
      e('HTTP_REQUEST_BODY_BECAME_REQUIRED', {
        logicalPath: bodyLabel,
        message: 'Request body became required.',
        before: 'optional',
        after: 'required',
        ...srcs(ob, nb),
      });
    }
    diffContent(ob.content, nb.content, 'request', bodyLabel, emitter, cmp, entityKey);
  }

  // ---- responses ------------------------------------------------------------
  const oStatuses = Object.keys(o.responses).sort();
  const nStatuses = Object.keys(n.responses).sort();
  for (const status of oStatuses) {
    const or = o.responses[status]!;
    let nr: HttpResponse | undefined = n.responses[status];
    if (!nr) {
      const range = nStatuses.find((s) => statusCovers(s, status));
      if (range) nr = n.responses[range];
    }
    const label = `${op} › response ${status}`;
    if (!nr) {
      const success = isSuccess(status) || /^[123]XX$/i.test(status);
      e(success ? 'HTTP_RESPONSE_SUCCESS_STATUS_REMOVED' : 'HTTP_RESPONSE_ERROR_STATUS_REMOVED', {
        logicalPath: label,
        message: `Response ${status} is no longer documented for ${op}.`,
        before: status,
        ...srcs(or, undefined),
      });
      continue;
    }
    diffContent(or.content, nr.content, 'response', label, emitter, cmp, entityKey);
    for (const [h, hdr] of Object.entries(or.headers)) {
      const nh = Object.entries(nr.headers).find(([k]) => k.toLowerCase() === h.toLowerCase())?.[1];
      if (!nh) {
        e('HTTP_RESPONSE_HEADER_REMOVED', {
          logicalPath: `${label} › header ${h}`,
          message: `Response header "${h}" is no longer documented.`,
          before: h,
          ...srcs(hdr, undefined),
        });
      } else {
        cmp.emitComparison(emitter, hdr.schema, nh.schema, 'response', {
          logicalPath: `${label} › header ${h}`,
          entityKey,
        });
      }
    }
  }
  for (const status of nStatuses) {
    if (o.responses[status]) continue;
    if (oStatuses.some((s) => statusCovers(status, s))) continue;
    const success = isSuccess(status) || /^[123]XX$/i.test(status);
    e(success ? 'HTTP_RESPONSE_SUCCESS_STATUS_ADDED' : 'HTTP_RESPONSE_ERROR_STATUS_ADDED', {
      logicalPath: `${op} › response ${status}`,
      message: `Response ${status} is now documented for ${op}.`,
      after: status,
      ...srcs(undefined, n.responses[status]),
    });
  }

  // ---- security -------------------------------------------------------------
  if (o.security && n.security) diffSecurity(o, n, o.security, n.security, emitter, entityKey, oldC, newC);
}

function diffContent(
  a: Record<string, HttpMediaType>,
  b: Record<string, HttpMediaType>,
  pol: 'request' | 'response',
  label: string,
  emitter: FindingEmitter,
  cmp: SchemaComparator,
  entityKey: string,
) {
  const norm = (rec: Record<string, HttpMediaType>) =>
    new Map(Object.entries(rec).map(([k, v]) => [normalizeMediaType(k), { key: k, v }]));
  const A = norm(a);
  const B = norm(b);
  for (const [mt, { key, v }] of A) {
    const other = B.get(mt);
    if (!other) {
      emitter.emit(
        pol === 'request' ? 'HTTP_REQUEST_MEDIA_TYPE_REMOVED' : 'HTTP_RESPONSE_MEDIA_TYPE_REMOVED',
        {
          logicalPath: `${label} › ${key}`,
          entityKey,
          message: `Media type ${key} is no longer ${pol === 'request' ? 'accepted' : 'produced'}.`,
          before: key,
          ...srcs(v, undefined),
        },
      );
      continue;
    }
    cmp.emitComparison(emitter, v.schema, other.v.schema, pol, {
      logicalPath: `${label} › ${mt === 'application/json' ? 'body' : `${mt} body`}`,
      entityKey,
    });
  }
  for (const [mt, { key, v }] of B) {
    if (A.has(mt)) continue;
    if (A.size === 0) continue;
    emitter.emit(pol === 'request' ? 'HTTP_REQUEST_MEDIA_TYPE_ADDED' : 'HTTP_RESPONSE_MEDIA_TYPE_ADDED', {
      logicalPath: `${label} › ${key}`,
      entityKey,
      message: `Media type ${key} is now ${pol === 'request' ? 'accepted' : 'produced'}.`,
      after: key,
      ...srcs(undefined, v),
    });
  }
}

const isAnonymous = (alts: SecurityRequirement[]) =>
  alts.length === 0 || alts.some((a) => Object.keys(a).length === 0);
const fmtAlt = (a: SecurityRequirement) =>
  Object.keys(a).length === 0
    ? 'anonymous'
    : Object.entries(a)
        .map(([k, s]) => (s.length ? `${k}[${[...s].sort().join(', ')}]` : k))
        .join(' + ');

/** b is at most as demanding as a: every scheme in b is in a, with a subset of scopes. */
function satisfiedBy(a: SecurityRequirement, b: SecurityRequirement): boolean {
  return Object.entries(b).every(
    ([k, scopes]) => a[k] !== undefined && scopes.every((s) => a[k]!.includes(s)),
  );
}

function diffSecurity(
  o: HttpOperation,
  n: HttpOperation,
  A: SecurityRequirement[],
  B: SecurityRequirement[],
  emitter: FindingEmitter,
  entityKey: string,
  _oldC: HttpContractModel,
  _newC: HttpContractModel,
) {
  const label = `${n.displayKey} › security`;
  const before = A.map(fmtAlt);
  const after = B.map(fmtAlt);
  const anonA = isAnonymous(A);
  const anonB = isAnonymous(B);
  if (anonA && !anonB) {
    emitter.emit('HTTP_SECURITY_ADDED', {
      logicalPath: label,
      entityKey,
      message: `${n.displayKey} allowed anonymous access and now requires ${after.join(' OR ')}.`,
      before,
      after,
      ...srcs(o, n),
    });
    return;
  }
  if (!anonA) {
    for (const a of A) {
      if (Object.keys(a).length === 0) continue;
      if (B.some((b) => satisfiedBy(a, b))) continue;
      const scopeOnly = B.find((b) => Object.keys(b).every((k) => a[k] !== undefined));
      if (scopeOnly) {
        const added = Object.entries(scopeOnly).flatMap(([k, s]) =>
          s.filter((x) => !a[k]!.includes(x)).map((x) => `${k}:${x}`),
        );
        emitter.emit('HTTP_SECURITY_SCOPES_ADDED', {
          logicalPath: label,
          entityKey,
          message: `Clients authenticating with ${fmtAlt(a)} now also need scope(s) ${added.join(', ')}.`,
          before: fmtAlt(a),
          after: fmtAlt(scopeOnly),
          ...srcs(o, n),
        });
      } else {
        emitter.emit('HTTP_SECURITY_TIGHTENED', {
          logicalPath: label,
          entityKey,
          message: `Clients authenticating with ${fmtAlt(a)} can no longer satisfy any accepted alternative (${after.join(' OR ') || 'none'}).`,
          before,
          after,
          ...srcs(o, n),
        });
      }
    }
  }
  // A new alternative is weaker when no baseline alternative is contained in it.
  const relaxed = anonB || B.some((b) => !A.some((a) => satisfiedBy(b, a)));
  if (relaxed && !anonA) {
    emitter.emit('HTTP_SECURITY_RELAXED', {
      logicalPath: label,
      entityKey,
      message: `Security for ${n.displayKey} relaxed: ${before.join(' OR ')} → ${after.join(' OR ')}.`,
      before,
      after,
      ...srcs(o, n),
    });
  }
}
