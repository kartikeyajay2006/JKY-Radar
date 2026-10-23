/** @import { Diagnostic, SourceRef } from '../domain/types.js' */
/** @import { JsonType, NSchema, SchemaConstraints } from '../domain/models.js' */
/** @import { JsonObject } from '../util/object.js' */

import { canonicalJson } from '../util/canonical.js';
import { getAtPointer, joinPointer } from '../util/pointer.js';
import { asBool, asNumber, asString, isObject } from '../util/object.js';

/** @typedef {'oas30' | 'oas31' | 'oas32' | 'swagger2' | 'draft4' | 'draft6' | 'draft7' | 'draft2019' | 'draft2020'} SchemaDialect */

/** @typedef {(pointer: string) => SourceRef | undefined} SourceLocator */

/**
 * @typedef {Object} NormalizeContext
 * @property {unknown} root
 * @property {SchemaDialect} dialect
 * @property {SourceLocator} locate
 * @property {Set<string>} ignored - Human-readable descriptions of constructs not compared semantically.
 * @property {Diagnostic[]} diagnostics
 * @property {Map<string, NSchema>} memo
 * @property {Set<string>} inProgress
 * @property {number} nodeCount
 * @property {number} maxNodes
 * @property {number} maxDepth
 */

/**
 * @param {unknown} root
 * @param {SchemaDialect} dialect
 * @param {SourceLocator} locate
 * @param {{ maxNodes?: number; maxDepth?: number }} [limits]
 * @returns {NormalizeContext}
 */
export function createNormalizeContext(root, dialect, locate, limits = {}) {
  return {
    root,
    dialect,
    locate,
    ignored: new Set(),
    diagnostics: [],
    memo: new Map(),
    inProgress: new Set(),
    nodeCount: 0,
    maxNodes: limits.maxNodes ?? 100_000,
    maxDepth: limits.maxDepth ?? 128,
  };
}

/** @type {ReadonlySet<string>} */
const JSON_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null']);

/** Keywords present in a schema that we detect but do not reason about. */
const UNSUPPORTED_KEYWORDS = /** @type {const} */ ([
  'patternProperties',
  'dependentSchemas',
  'dependentRequired',
  'dependencies',
  'unevaluatedProperties',
  'unevaluatedItems',
  '$dynamicRef',
  '$dynamicAnchor',
  '$recursiveRef',
  'contains',
  'minContains',
  'maxContains',
  'propertyNames',
  'prefixItems',
  'additionalItems',
  'discriminator',
  'contentSchema',
  'contentMediaType',
  'contentEncoding',
]);

/** @param {SchemaDialect} d */
const legacyExclusive = (d) => d === 'oas30' || d === 'swagger2' || d === 'draft4';

/**
 * @param {string} id
 * @param {SourceRef} [src]
 * @returns {NSchema}
 */
function emptySchema(id, src) {
  /** @type {NSchema} */
  const s = {
    id,
    types: null,
    properties: {},
    required: [],
    constraints: {},
    combinators: {},
    unsupported: {},
  };
  if (src) s.src = src;
  return s;
}

/**
 * Normalise a raw schema (JSON value) located at `pointer` inside ctx.root.
 * Local refs ("#/...") resolve to shared NSchema nodes (cycle-safe). Remote refs are never fetched.
 * @param {unknown} raw
 * @param {string} pointer
 * @param {NormalizeContext} ctx
 * @returns {NSchema}
 */
export function normalizeSchema(raw, pointer, ctx, depth = 0) {
  const memoHit = ctx.memo.get(pointer);
  if (memoHit) return memoHit;

  const node = emptySchema(pointer, ctx.locate(pointer));
  ctx.memo.set(pointer, node);
  ctx.nodeCount++;

  if (ctx.nodeCount > ctx.maxNodes || depth > ctx.maxDepth) {
    node.unsupported['x-jky-budget'] = '"exceeded"';
    ctx.ignored.add('Schema subtrees beyond the normalisation budget');
    return node;
  }

  if (raw === true || raw === undefined) return node;
  if (raw === false) {
    node.types = [];
    return node;
  }
  if (!isObject(raw)) {
    ctx.diagnostics.push({
      severity: 'warning',
      code: 'SCHEMA_INVALID',
      message: `Schema at ${pointer} is not an object; treated as unconstrained.`,
      source: node.src,
    });
    return node;
  }

  // ---- $ref handling -------------------------------------------------
  const ref = asString(raw.$ref);
  if (ref !== undefined) {
    const siblings = Object.keys(raw).filter((k) => !['$ref', 'description', 'summary', 'title'].includes(k));
    if (siblings.length > 0 && (ctx.dialect === 'oas30' || ctx.dialect === 'swagger2')) {
      ctx.diagnostics.push({
        severity: 'info',
        code: 'REF_SIBLINGS_IGNORED',
        message: `Keywords next to $ref at ${pointer} are ignored by ${ctx.dialect === 'oas30' ? 'OpenAPI 3.0' : 'Swagger 2.0'}.`,
        source: node.src,
      });
    } else if (siblings.length > 0) {
      ctx.ignored.add('$ref with sibling keywords (siblings not merged)');
    }
    if (ref.startsWith('#')) {
      const targetPointer = ref === '#' ? '' : ref.slice(1);
      let decoded = targetPointer;
      try {
        decoded = decodeURIComponent(targetPointer);
      } catch {
        /* keep raw */
      }
      const target = safeGet(ctx.root, decoded);
      if (target === undefined) {
        node.unresolvedRef = ref;
        ctx.ignored.add('Unresolvable local $ref');
        ctx.diagnostics.push({
          severity: 'error',
          code: 'REF_NOT_FOUND',
          message: `Local reference ${ref} (at ${pointer}) does not resolve.`,
          source: node.src,
        });
        return node;
      }
      ctx.memo.delete(pointer);
      ctx.nodeCount--;
      const resolved = normalizeSchema(target, decoded, ctx, depth + 1);
      ctx.memo.set(pointer, resolved);
      return resolved;
    }
    node.unresolvedRef = ref;
    ctx.ignored.add('Remote $ref (never fetched)');
    ctx.diagnostics.push({
      severity: 'warning',
      code: 'REF_REMOTE_NOT_FETCHED',
      message: `Remote reference "${ref}" at ${pointer} was not fetched (remote resolution is disabled for security). Its content is not compared.`,
      source: node.src,
    });
    return node;
  }

  ctx.inProgress.add(pointer);
  try {
    fillSchema(node, raw, pointer, ctx, depth);
  } finally {
    ctx.inProgress.delete(pointer);
  }
  return node;
}

/**
 * @param {unknown} root
 * @param {string} pointer
 * @returns {unknown}
 */
function safeGet(root, pointer) {
  try {
    return getAtPointer(root, pointer);
  } catch {
    return undefined;
  }
}

/**
 * @param {NSchema} node
 * @param {JsonObject} raw
 * @param {string} pointer
 * @param {NormalizeContext} ctx
 * @param {number} depth
 * @returns {void}
 */
function fillSchema(node, raw, pointer, ctx, depth) {
  const d = ctx.dialect;

  // ---- types & nullability ------------------------------------------
  /** @type {JsonType[] | null} */
  let types = null;
  const t = raw.type;
  if (typeof t === 'string') types = [/** @type {JsonType} */ (t)];
  else if (Array.isArray(t)) types = t.filter(/** @returns {x is JsonType} */ (x) => typeof x === 'string');
  if (types) {
    const unknown = types.filter((x) => !JSON_TYPES.has(x));
    if (unknown.includes(/** @type {JsonType} */ ('file')) && d === 'swagger2') {
      types = types.map((x) => (x === /** @type {JsonType} */ ('file') ? 'string' : x));
      node.format = 'binary';
    } else if (unknown.length > 0) {
      ctx.diagnostics.push({
        severity: 'warning',
        code: 'SCHEMA_UNKNOWN_TYPE',
        message: `Unknown type(s) ${unknown.join(', ')} at ${pointer}.`,
        source: node.src,
      });
      types = types.filter((x) => JSON_TYPES.has(x));
    }
  }
  const nullableFlag = raw.nullable === true || (d === 'swagger2' && raw['x-nullable'] === true);
  if (nullableFlag) {
    if (d === 'oas31' || d === 'oas32' || d.startsWith('draft')) {
      ctx.diagnostics.push({
        severity: 'warning',
        code: 'NULLABLE_KEYWORD_OUTSIDE_OAS30',
        message: `"nullable" at ${pointer} is not part of this dialect; interpreted as type null for compatibility.`,
        source: node.src,
      });
    }
    if (types && !types.includes('null')) types = [...types, 'null'];
  }
  if (types) node.types = [...new Set(types)].sort();

  // ---- enum / const ----------------------------------------------------
  if (Array.isArray(raw.enum)) node.enum = raw.enum.slice();
  if ('const' in raw) node.const = { value: raw.const };

  // ---- constraints -----------------------------------------------------
  /** @type {SchemaConstraints} */
  const c = {};
  /** @param {keyof SchemaConstraints & string} k */
  const num = (k) => {
    const v = asNumber(raw[k]);
    if (v !== undefined) /** @type {Record<string, number>} */ (c)[k] = v;
  };
  /** @type {const} */ ([
    'minLength',
    'maxLength',
    'multipleOf',
    'minItems',
    'maxItems',
    'minProperties',
    'maxProperties',
  ]).forEach(num);
  const minimum = asNumber(raw.minimum);
  const maximum = asNumber(raw.maximum);
  if (legacyExclusive(d)) {
    if (minimum !== undefined) {
      if (raw.exclusiveMinimum === true) c.exclusiveMinimum = minimum;
      else c.minimum = minimum;
    }
    if (maximum !== undefined) {
      if (raw.exclusiveMaximum === true) c.exclusiveMaximum = maximum;
      else c.maximum = maximum;
    }
  } else {
    if (minimum !== undefined) c.minimum = minimum;
    if (maximum !== undefined) c.maximum = maximum;
    const exMin = asNumber(raw.exclusiveMinimum);
    const exMax = asNumber(raw.exclusiveMaximum);
    if (exMin !== undefined) c.exclusiveMinimum = exMin;
    if (exMax !== undefined) c.exclusiveMaximum = exMax;
  }
  if (raw.uniqueItems === true) c.uniqueItems = true;
  node.constraints = c;

  const pattern = asString(raw.pattern);
  if (pattern !== undefined) node.pattern = pattern;
  const format = asString(raw.format);
  if (format !== undefined && node.format === undefined) node.format = format;
  const ro = asBool(raw.readOnly);
  const wo = asBool(raw.writeOnly);
  if (ro) node.readOnly = true;
  if (wo) node.writeOnly = true;
  if (raw.deprecated === true) node.deprecated = true;
  if ('default' in raw) node.default = { value: raw.default };
  const description = asString(raw.description);
  if (description !== undefined) node.description = description;
  const title = asString(raw.title);
  if (title !== undefined) node.title = title;

  // ---- object keywords -------------------------------------------------
  if (isObject(raw.properties)) {
    for (const [name, sub] of Object.entries(raw.properties)) {
      node.properties[name] = normalizeSchema(sub, joinPointer(pointer, 'properties', name), ctx, depth + 1);
    }
  }
  if (Array.isArray(raw.required)) {
    node.required = [
      ...new Set(raw.required.filter(/** @returns {x is string} */ (x) => typeof x === 'string')),
    ].sort();
  }
  if (raw.additionalProperties === false) node.additionalProperties = false;
  else if (raw.additionalProperties === true) node.additionalProperties = true;
  else if (isObject(raw.additionalProperties)) {
    node.additionalProperties = normalizeSchema(
      raw.additionalProperties,
      joinPointer(pointer, 'additionalProperties'),
      ctx,
      depth + 1,
    );
  }

  // ---- array keywords --------------------------------------------------
  if (isObject(raw.items) || typeof raw.items === 'boolean') {
    node.items = normalizeSchema(raw.items, joinPointer(pointer, 'items'), ctx, depth + 1);
  } else if (Array.isArray(raw.items)) {
    node.unsupported['items(tuple)'] = canonicalJson(raw.items);
    ctx.ignored.add('Tuple-form "items" arrays');
  }

  // ---- unsupported keywords -------------------------------------------
  for (const k of UNSUPPORTED_KEYWORDS) {
    if (k in raw) {
      node.unsupported[k] = canonicalJson(raw[k]);
      ctx.ignored.add(`JSON Schema keyword "${k}"`);
    }
  }

  // ---- composition -----------------------------------------------------
  /** @param {'allOf' | 'oneOf' | 'anyOf'} k */
  const list = (k) =>
    Array.isArray(raw[k])
      ? /** @type {unknown[]} */ (raw[k]).map((s, i) =>
          normalizeSchema(s, joinPointer(pointer, k, i), ctx, depth + 1),
        )
      : undefined;
  const allOf = list('allOf');
  const oneOf = list('oneOf');
  const anyOf = list('anyOf');
  if (oneOf) {
    node.combinators.oneOf = oneOf;
    ctx.ignored.add('oneOf composition');
  }
  if (anyOf) {
    node.combinators.anyOf = anyOf;
    ctx.ignored.add('anyOf composition');
  }
  if ('not' in raw) {
    node.combinators.not = normalizeSchema(raw.not, joinPointer(pointer, 'not'), ctx, depth + 1);
    ctx.ignored.add('"not" composition');
  }
  if ('if' in raw || 'then' in raw || 'else' in raw) {
    /** @type {NonNullable<NSchema['combinators']['conditional']>} */
    const cond = {};
    if ('if' in raw) cond.if = normalizeSchema(raw.if, joinPointer(pointer, 'if'), ctx, depth + 1);
    if ('then' in raw) cond.then = normalizeSchema(raw.then, joinPointer(pointer, 'then'), ctx, depth + 1);
    if ('else' in raw) cond.else = normalizeSchema(raw.else, joinPointer(pointer, 'else'), ctx, depth + 1);
    node.combinators.conditional = cond;
    ctx.ignored.add('if/then/else conditionals');
  }
  if (allOf) {
    if (!tryMergeAllOf(node, allOf, ctx)) {
      node.combinators.allOf = allOf;
      ctx.ignored.add('allOf composition that cannot be merged safely');
    }
  }
}

/**
 * Merge allOf members into the node when every member is a plain object-ish schema
 * with no composition, no conflicting property definitions and no additionalProperties.
 * Otherwise keep allOf as an uncertain combinator.
 * @param {NSchema} node
 * @param {NSchema[]} members
 * @param {NormalizeContext} ctx
 * @returns {boolean}
 */
function tryMergeAllOf(node, members, ctx) {
  for (const m of members) {
    if (ctx.inProgress.has(m.id)) return false;
    if (m.unresolvedRef) return false;
    if (Object.keys(m.combinators).length > 0) return false;
    if (Object.keys(m.unsupported).length > 0) return false;
    if (m.additionalProperties !== undefined) return false;
    if (m.types && !(m.types.length === 1 && m.types[0] === 'object')) return false;
    if (m.enum || m.const || m.items) return false;
  }
  /** @type {Record<string, NSchema>} */
  const props = { ...node.properties };
  const required = new Set(node.required);
  for (const m of members) {
    for (const [name, sub] of Object.entries(m.properties)) {
      const existing = props[name];
      if (existing && existing !== sub) return false;
      props[name] = sub;
    }
    m.required.forEach((r) => required.add(r));
  }
  node.properties = props;
  node.required = [...required].sort();
  if (!node.types && members.some((m) => m.types)) node.types = ['object'];
  node.mergedAllOf = true;
  return true;
}
