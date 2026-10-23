import type { SchemaPolarity, SourceRef } from '../domain/types.js';
import type { JsonType, NSchema, SchemaConstraints } from '../domain/models.js';
import { canonicalJson, preview } from '../util/canonical.js';
import type { EmitInput, FindingEmitter } from '../rules/emitter.js';

/** A change relative to the schema being compared; re-based onto each usage site. */
export interface RelChange {
  rel: string;
  ruleId: string;
  message: string;
  before?: unknown;
  after?: unknown;
  oSrc?: SourceRef;
  nSrc?: SourceRef;
  tags?: string[];
}

export interface SchemaCompareOptions {
  maxDepth?: number;
  maxComparisons?: number;
}

/**
 * Polarity-aware structural comparison of normalised schemas.
 *  - request polarity: the new schema must accept everything the old one accepted.
 *  - response polarity: everything the new schema can produce must satisfy the old one.
 */
export class SchemaComparator {
  private readonly cache = new Map<string, RelChange[]>();
  private readonly stack = new Set<string>();
  private comparisons = 0;
  private readonly maxDepth: number;
  private readonly maxComparisons: number;
  private readonly pairIds = new WeakMap<NSchema, number>();
  private nextId = 1;

  constructor(opts: SchemaCompareOptions = {}) {
    this.maxDepth = opts.maxDepth ?? 48;
    this.maxComparisons = opts.maxComparisons ?? 250_000;
  }

  private idOf(s: NSchema): number {
    let id = this.pairIds.get(s);
    if (!id) {
      id = this.nextId++;
      this.pairIds.set(s, id);
    }
    return id;
  }

  /** Compare and emit findings under a logical path prefix. */
  emitComparison(
    emitter: FindingEmitter,
    o: NSchema | undefined,
    n: NSchema | undefined,
    polarity: SchemaPolarity,
    base: { logicalPath: string; entityKey?: string; tags?: string[] },
  ): void {
    if (!o || !n) return;
    for (const c of this.compare(o, n, polarity, 0)) {
      const input: EmitInput = {
        logicalPath: `${base.logicalPath}${c.rel}`,
        message: c.message,
        before: c.before,
        after: c.after,
        tags: [...(base.tags ?? []), ...(c.tags ?? []), polarity],
      };
      if (base.entityKey) input.entityKey = base.entityKey;
      if (c.oSrc) input.baselineSource = c.oSrc;
      if (c.nSrc) input.candidateSource = c.nSrc;
      emitter.emit(c.ruleId, input);
    }
  }

  compare(o: NSchema, n: NSchema, pol: SchemaPolarity, depth: number): RelChange[] {
    const key = `${this.idOf(o)}|${this.idOf(n)}|${pol}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    if (this.stack.has(key)) return []; // recursive back-edge: already being compared above
    if (depth > this.maxDepth || ++this.comparisons > this.maxComparisons) {
      return [
        {
          rel: '',
          ruleId: 'SCHEMA_DEPTH_LIMIT',
          message: `Comparison stopped at depth ${depth}; deeper differences were not analysed.`,
          tags: ['coverage-gap'],
          ...src(o, n),
        },
      ];
    }
    this.stack.add(key);
    const out: RelChange[] = [];
    try {
      this.compareNode(o, n, pol, depth, out);
    } finally {
      this.stack.delete(key);
    }
    this.cache.set(key, out);
    return out;
  }

  private compareNode(o: NSchema, n: NSchema, pol: SchemaPolarity, depth: number, out: RelChange[]): void {
    const push = (c: Omit<RelChange, 'rel'> & { rel?: string }) => out.push({ rel: '', ...src(o, n), ...c });
    const req = pol === 'request';

    // Unresolvable references: we cannot see the content.
    if (o.unresolvedRef || n.unresolvedRef) {
      if (o.unresolvedRef !== n.unresolvedRef) {
        push({
          ruleId: 'SCHEMA_REF_UNRESOLVED',
          message: `Reference changed from ${o.unresolvedRef ?? '(inline schema)'} to ${n.unresolvedRef ?? '(inline schema)'}; referenced content is not resolved, so compatibility is unknown.`,
          before: o.unresolvedRef,
          after: n.unresolvedRef,
          tags: ['coverage-gap'],
        });
      }
      return;
    }

    this.compareTypes(o, n, pol, push);
    this.compareEnum(o, n, pol, push);
    this.compareConstraints(o, n, pol, push);

    // pattern
    if (o.pattern !== n.pattern) {
      if (req) {
        if (n.pattern !== undefined) {
          push({
            ruleId: 'REQ_PATTERN_CHANGED',
            message: `Request pattern ${o.pattern === undefined ? 'added' : 'changed'}: ${preview(o.pattern)} → ${preview(n.pattern)}.`,
            before: o.pattern,
            after: n.pattern,
            tags: ['coverage-gap'],
          });
        } else {
          push({
            ruleId: 'REQ_CONSTRAINT_RELAXED',
            message: `Request pattern ${preview(o.pattern)} removed.`,
            before: o.pattern,
            tags: ['pattern'],
          });
        }
      } else if (o.pattern !== undefined) {
        push({
          ruleId: 'RES_PATTERN_CHANGED',
          message: `Response pattern ${n.pattern === undefined ? 'removed' : 'changed'}: ${preview(o.pattern)} → ${preview(n.pattern)}.`,
          before: o.pattern,
          after: n.pattern,
          tags: ['coverage-gap'],
        });
      } else {
        push({
          ruleId: 'RES_CONSTRAINT_TIGHTENED',
          message: `Response pattern ${preview(n.pattern)} added.`,
          after: n.pattern,
          tags: ['pattern'],
        });
      }
    }

    if (o.format !== n.format) {
      push({
        ruleId: 'SCHEMA_FORMAT_CHANGED',
        message: `Format changed from ${preview(o.format)} to ${preview(n.format)}.`,
        before: o.format,
        after: n.format,
      });
    }

    if (req && o.default !== undefined && canonicalJson(o.default) !== canonicalJson(n.default)) {
      push({
        ruleId: 'REQ_DEFAULT_CHANGED',
        message: `Default value changed from ${preview(o.default.value)} to ${n.default ? preview(n.default.value) : '(no default)'}.`,
        before: o.default.value,
        after: n.default?.value,
      });
    }

    if (!!o.readOnly !== !!n.readOnly || !!o.writeOnly !== !!n.writeOnly) {
      push({
        ruleId: 'SCHEMA_READ_WRITE_CHANGED',
        message: `Direction flags changed: readOnly ${!!o.readOnly} → ${!!n.readOnly}, writeOnly ${!!o.writeOnly} → ${!!n.writeOnly}.`,
        before: { readOnly: !!o.readOnly, writeOnly: !!o.writeOnly },
        after: { readOnly: !!n.readOnly, writeOnly: !!n.writeOnly },
      });
    }
    if (!o.deprecated && n.deprecated) {
      push({ ruleId: 'SCHEMA_PROPERTY_DEPRECATED', message: 'Value is now marked deprecated.', after: true });
    }
    if ((o.description ?? '') !== (n.description ?? '') || (o.title ?? '') !== (n.title ?? '')) {
      push({
        ruleId: 'SCHEMA_DOCS_CHANGED',
        message: 'Title/description text changed.',
        before: { title: o.title, description: o.description },
        after: { title: n.title, description: n.description },
      });
    }

    // Composition: compared structurally, never assumed equivalent.
    const combinatorChanged = this.compareCombinators(o, n, pol, depth, push);
    if (!combinatorChanged) this.compareProperties(o, n, pol, depth, out);

    // items
    if (o.items && n.items) {
      for (const c of this.compare(o.items, n.items, pol, depth + 1)) out.push({ ...c, rel: `[]${c.rel}` });
    } else if (o.items && !n.items && isArrayish(n)) {
      push({
        ruleId: req ? 'REQ_CONSTRAINT_RELAXED' : 'RES_CONSTRAINT_RELAXED',
        message: 'Array item schema is no longer constrained.',
        tags: ['items'],
      });
    } else if (!o.items && n.items && isArrayish(o)) {
      push({
        ruleId: req ? 'REQ_CONSTRAINT_TIGHTENED' : 'RES_CONSTRAINT_TIGHTENED',
        message: 'Array items are now constrained by a schema.',
        tags: ['items'],
      });
    }

    // unmodelled keywords
    const kws = new Set([...Object.keys(o.unsupported), ...Object.keys(n.unsupported)]);
    for (const k of [...kws].sort()) {
      if (o.unsupported[k] !== n.unsupported[k]) {
        push({
          ruleId: 'SCHEMA_UNSUPPORTED_KEYWORD_CHANGED',
          message: `Keyword "${k}" changed; JKY-Radar does not evaluate its compatibility effect.`,
          before: parseMaybe(o.unsupported[k]),
          after: parseMaybe(n.unsupported[k]),
          tags: ['coverage-gap', `keyword:${k}`],
        });
      }
    }
  }

  private compareTypes(
    o: NSchema,
    n: NSchema,
    pol: SchemaPolarity,
    push: (c: Omit<RelChange, 'rel'>) => void,
  ) {
    const A = o.types;
    const B = n.types;
    if (A === null && B === null) return;
    const fmt = (t: JsonType[] | null) => (t === null ? 'any' : t.length === 0 ? 'nothing' : t.join(' | '));
    if (pol === 'request') {
      if (A === null) {
        push({
          ruleId: 'REQ_TYPE_NARROWED',
          message: `Request value was unconstrained; now limited to ${fmt(B)}.`,
          before: 'any',
          after: B,
        });
        return;
      }
      if (B === null) {
        push({
          ruleId: 'REQ_TYPE_WIDENED',
          message: `Request value now accepts any type (was ${fmt(A)}).`,
          before: A,
          after: 'any',
        });
        return;
      }
      const removed = A.filter((t) => !covers(B, t));
      const added = B.filter((t) => !covers(A, t));
      if (removed.length === 1 && removed[0] === 'null') {
        push({
          ruleId: 'REQ_NULL_REMOVED',
          message: 'Request value no longer accepts null.',
          before: A,
          after: B,
        });
      } else if (removed.length > 0) {
        push({
          ruleId: 'REQ_TYPE_NARROWED',
          message: `Request value no longer accepts ${removed.join(', ')} (was ${fmt(A)}, now ${fmt(B)}).`,
          before: A,
          after: B,
        });
      } else if (added.length > 0) {
        push({
          ruleId: 'REQ_TYPE_WIDENED',
          message: `Request value also accepts ${added.join(', ')} now.`,
          before: A,
          after: B,
        });
      }
      return;
    }
    // response
    if (A === null) {
      push({
        ruleId: 'RES_TYPE_NARROWED',
        message: `Response value now limited to ${fmt(B)} (was unconstrained).`,
        before: 'any',
        after: B,
      });
      return;
    }
    if (B === null) {
      push({
        ruleId: 'RES_TYPE_CHANGED',
        message: `Response value may now be of any type (was ${fmt(A)}).`,
        before: A,
        after: 'any',
      });
      return;
    }
    const added = B.filter((t) => !covers(A, t));
    const removed = A.filter((t) => !covers(B, t));
    if (added.length === 1 && added[0] === 'null') {
      push({ ruleId: 'RES_NULL_ADDED', message: 'Response value may now be null.', before: A, after: B });
    } else if (added.length > 0) {
      push({
        ruleId: 'RES_TYPE_CHANGED',
        message: `Response value may now be ${added.filter((t) => t !== 'null').join(', ')} (was ${fmt(A)}, now ${fmt(B)}).`,
        before: A,
        after: B,
      });
    } else if (removed.length > 0) {
      push({
        ruleId: 'RES_TYPE_NARROWED',
        message: `Response value no longer produces ${removed.join(', ')}.`,
        before: A,
        after: B,
      });
    }
  }

  private compareEnum(
    o: NSchema,
    n: NSchema,
    pol: SchemaPolarity,
    push: (c: Omit<RelChange, 'rel'>) => void,
  ) {
    const req = pol === 'request';
    if (o.enum && n.enum) {
      const oSet = new Map(o.enum.map((v) => [canonicalJson(v), v]));
      const nSet = new Map(n.enum.map((v) => [canonicalJson(v), v]));
      const removed = [...oSet.keys()].filter((k) => !nSet.has(k)).map((k) => oSet.get(k));
      const added = [...nSet.keys()].filter((k) => !oSet.has(k)).map((k) => nSet.get(k));
      if (removed.length > 0) {
        push({
          ruleId: req ? 'REQ_ENUM_VALUE_REMOVED' : 'RES_ENUM_VALUE_REMOVED',
          message: `Enum value(s) ${removed.map((v) => preview(v)).join(', ')} removed.`,
          before: o.enum,
          after: n.enum,
        });
      }
      if (added.length > 0) {
        push({
          ruleId: req ? 'REQ_ENUM_VALUE_ADDED' : 'RES_ENUM_VALUE_ADDED',
          message: `Enum value(s) ${added.map((v) => preview(v)).join(', ')} added.`,
          before: o.enum,
          after: n.enum,
        });
      }
    } else if (!o.enum && n.enum) {
      push({
        ruleId: req ? 'REQ_CONSTRAINT_TIGHTENED' : 'RES_CONSTRAINT_TIGHTENED',
        message: `Value is now restricted to the enum ${preview(n.enum)}.`,
        after: n.enum,
        tags: ['enum'],
      });
    } else if (o.enum && !n.enum) {
      push({
        ruleId: req ? 'REQ_CONSTRAINT_RELAXED' : 'RES_CONSTRAINT_RELAXED',
        message: `Enum restriction ${preview(o.enum)} removed.`,
        before: o.enum,
        tags: ['enum'],
      });
    }
    const oc = o.const ? canonicalJson(o.const.value) : undefined;
    const nc = n.const ? canonicalJson(n.const.value) : undefined;
    if (oc !== nc) {
      if (nc !== undefined && oc !== undefined) {
        push({
          ruleId: req ? 'REQ_CONSTRAINT_TIGHTENED' : 'RES_CONSTRAINT_RELAXED',
          message: `Constant value changed from ${oc} to ${nc}.`,
          before: o.const?.value,
          after: n.const?.value,
          tags: ['const'],
        });
      } else if (nc !== undefined) {
        push({
          ruleId: req ? 'REQ_CONSTRAINT_TIGHTENED' : 'RES_CONSTRAINT_TIGHTENED',
          message: `Value is now fixed to the constant ${nc}.`,
          after: n.const?.value,
          tags: ['const'],
        });
      } else {
        push({
          ruleId: req ? 'REQ_CONSTRAINT_RELAXED' : 'RES_CONSTRAINT_RELAXED',
          message: `Constant restriction ${oc} removed.`,
          before: o.const?.value,
          tags: ['const'],
        });
      }
    }
  }

  private compareConstraints(
    o: NSchema,
    n: NSchema,
    pol: SchemaPolarity,
    push: (c: Omit<RelChange, 'rel'>) => void,
  ) {
    const req = pol === 'request';
    const emit = (keyword: string, tightened: boolean, before: unknown, after: unknown) => {
      const ruleId = tightened
        ? req
          ? 'REQ_CONSTRAINT_TIGHTENED'
          : 'RES_CONSTRAINT_TIGHTENED'
        : req
          ? 'REQ_CONSTRAINT_RELAXED'
          : 'RES_CONSTRAINT_RELAXED';
      push({
        ruleId,
        message: `${keyword} ${tightened ? 'tightened' : 'relaxed'}: ${preview(before)} → ${preview(after)}.`,
        before,
        after,
        tags: [`keyword:${keyword}`],
      });
    };
    const oc = o.constraints;
    const nc = n.constraints;
    const upper = ['maxLength', 'maxItems', 'maxProperties'] as const;
    const lower = ['minLength', 'minItems', 'minProperties'] as const;
    for (const k of upper) cmpBound(k, oc[k], nc[k], 'upper', emit);
    for (const k of lower) cmpBound(k, oc[k], nc[k], 'lower', emit);

    // numeric bounds with exclusivity folded together
    const lo = (c: SchemaConstraints) => numericBound(c.minimum, c.exclusiveMinimum, 'lower');
    const hi = (c: SchemaConstraints) => numericBound(c.maximum, c.exclusiveMaximum, 'upper');
    cmpNumeric('minimum', lo(oc), lo(nc), 'lower', emit);
    cmpNumeric('maximum', hi(oc), hi(nc), 'upper', emit);

    if (oc.multipleOf !== nc.multipleOf) {
      if (nc.multipleOf === undefined) emit('multipleOf', false, oc.multipleOf, undefined);
      else if (oc.multipleOf === undefined) emit('multipleOf', true, undefined, nc.multipleOf);
      else {
        const relaxed = isMultiple(oc.multipleOf, nc.multipleOf);
        emit('multipleOf', !relaxed, oc.multipleOf, nc.multipleOf);
      }
    }
    if (!!oc.uniqueItems !== !!nc.uniqueItems)
      emit('uniqueItems', !!nc.uniqueItems, !!oc.uniqueItems, !!nc.uniqueItems);
  }

  /** Returns true when composition differs (and was reported), so property diffing is skipped. */
  private compareCombinators(
    o: NSchema,
    n: NSchema,
    pol: SchemaPolarity,
    depth: number,
    push: (c: Omit<RelChange, 'rel'>) => void,
  ): boolean {
    const kinds = ['allOf', 'oneOf', 'anyOf'] as const;
    let changed = false;
    for (const k of kinds) {
      const a = o.combinators[k];
      const b = n.combinators[k];
      if (!a && !b) continue;
      let differs = !a || !b || a.length !== b.length;
      let inner: string[] = [];
      if (!differs && a && b) {
        for (let i = 0; i < a.length; i++) {
          const changes = this.compare(a[i]!, b[i]!, pol, depth + 1).filter(
            (c) => c.ruleId !== 'SCHEMA_DOCS_CHANGED',
          );
          if (changes.length > 0) {
            differs = true;
            inner = inner.concat(changes.map((c) => `${k}[${i}]${c.rel}: ${c.ruleId}`));
          }
        }
      }
      if (differs) {
        changed = true;
        push({
          ruleId: 'SCHEMA_COMBINATOR_CHANGED',
          message:
            !a || !b
              ? `"${k}" composition was ${a ? 'removed' : 'introduced'}; the accepted value set may change in either direction.`
              : a.length !== b.length
                ? `"${k}" now has ${b.length} branch(es) instead of ${a.length}.`
                : `"${k}" branch content changed (${inner.slice(0, 5).join('; ')}${inner.length > 5 ? '; …' : ''}).`,
          before: a ? `${k}[${a.length}]` : undefined,
          after: b ? `${k}[${b.length}]` : undefined,
          tags: ['coverage-gap', `keyword:${k}`],
        });
      }
    }
    if (
      !!o.combinators.not !== !!n.combinators.not ||
      (o.combinators.not &&
        n.combinators.not &&
        this.compare(
          o.combinators.not,
          n.combinators.not,
          pol === 'request' ? 'response' : 'request',
          depth + 1,
        ).length > 0)
    ) {
      changed = true;
      push({
        ruleId: 'SCHEMA_COMBINATOR_CHANGED',
        message: '"not" composition changed.',
        tags: ['coverage-gap', 'keyword:not'],
      });
    }
    const oc = o.combinators.conditional;
    const nc = n.combinators.conditional;
    if (!!oc !== !!nc || (oc && nc && condChanged(this, oc, nc, pol, depth))) {
      changed = true;
      push({
        ruleId: 'SCHEMA_COMBINATOR_CHANGED',
        message: 'if/then/else conditional changed.',
        tags: ['coverage-gap', 'keyword:if'],
      });
    }
    return changed;
  }

  private compareProperties(
    o: NSchema,
    n: NSchema,
    pol: SchemaPolarity,
    depth: number,
    out: RelChange[],
  ): void {
    const req = pol === 'request';
    const names = [...new Set([...Object.keys(o.properties), ...Object.keys(n.properties)])].sort();
    if (names.length === 0) return this.compareAdditional(o, n, pol, depth, out);
    const effRequired = (s: NSchema, name: string) => {
      if (!s.required.includes(name)) return false;
      const p = s.properties[name];
      if (!p) return true;
      return req ? !p.readOnly : !p.writeOnly;
    };
    const skip = (p: NSchema | undefined) => (p ? (req ? !!p.readOnly : !!p.writeOnly) : false);

    for (const name of names) {
      const op = o.properties[name];
      const np = n.properties[name];
      const rel = `.${name}`;
      const s = { oSrc: op?.src ?? o.src, nSrc: np?.src ?? n.src };
      if (op && !np) {
        if (skip(op)) continue;
        if (req) {
          const strict = n.additionalProperties === false;
          out.push({
            rel,
            ruleId: strict ? 'REQ_PROPERTY_REMOVED_STRICT' : 'REQ_PROPERTY_REMOVED',
            message: `Request property "${name}" was removed${strict ? ' and the object no longer allows additional properties' : ''}.`,
            before: name,
            ...s,
          });
        } else {
          const wasRequired = effRequired(o, name);
          out.push({
            rel,
            ruleId: wasRequired ? 'RES_PROPERTY_REMOVED' : 'RES_OPTIONAL_PROPERTY_REMOVED',
            message: `${wasRequired ? 'Guaranteed' : 'Optional'} response property "${name}" was removed.`,
            before: name,
            ...s,
          });
        }
        continue;
      }
      if (!op && np) {
        if (skip(np)) continue;
        if (req) {
          const required = effRequired(n, name);
          out.push({
            rel,
            ruleId: required ? 'REQ_PROPERTY_REQUIRED_ADDED' : 'REQ_PROPERTY_OPTIONAL_ADDED',
            message: `${required ? 'Required' : 'Optional'} request property "${name}" was added.`,
            after: name,
            ...s,
          });
        } else {
          out.push({
            rel,
            ruleId: 'RES_PROPERTY_ADDED',
            message: `Response property "${name}" was added.`,
            after: name,
            ...s,
          });
        }
        continue;
      }
      if (!op || !np) continue;
      const or = effRequired(o, name);
      const nr = effRequired(n, name);
      if (or !== nr && !(skip(op) && skip(np))) {
        if (req) {
          out.push({
            rel,
            ruleId: nr ? 'REQ_PROPERTY_BECAME_REQUIRED' : 'REQ_PROPERTY_BECAME_OPTIONAL',
            message: `Request property "${name}" became ${nr ? 'required' : 'optional'}.`,
            before: or ? 'required' : 'optional',
            after: nr ? 'required' : 'optional',
            ...s,
          });
        } else {
          out.push({
            rel,
            ruleId: nr ? 'RES_PROPERTY_BECAME_REQUIRED' : 'RES_PROPERTY_BECAME_OPTIONAL',
            message: `Response property "${name}" is ${nr ? 'now guaranteed' : 'no longer guaranteed'}.`,
            before: or ? 'required' : 'optional',
            after: nr ? 'required' : 'optional',
            ...s,
          });
        }
      }
      if (skip(op) && skip(np)) continue;
      for (const c of this.compare(op, np, pol, depth + 1)) out.push({ ...c, rel: `${rel}${c.rel}` });
    }
    this.compareAdditional(o, n, pol, depth, out);
  }

  private compareAdditional(
    o: NSchema,
    n: NSchema,
    pol: SchemaPolarity,
    depth: number,
    out: RelChange[],
  ): void {
    const a = o.additionalProperties;
    const b = n.additionalProperties;
    if (pol === 'request' && a !== false && b === false) {
      out.push({
        rel: '',
        ruleId: 'REQ_ADDITIONAL_PROPERTIES_RESTRICTED',
        message: 'Request object no longer accepts additional (undocumented) properties.',
        before: a === undefined ? 'allowed' : a === true ? true : 'schema',
        after: false,
        ...src(o, n),
      });
    } else if (typeof a === 'object' && typeof b === 'object') {
      for (const c of this.compare(a, b, pol, depth + 1)) out.push({ ...c, rel: `.*${c.rel}` });
    }
  }
}

/* ---------------------------------------------------------------- helpers */

function src(o: NSchema, n: NSchema): { oSrc?: SourceRef; nSrc?: SourceRef } {
  const r: { oSrc?: SourceRef; nSrc?: SourceRef } = {};
  if (o.src) r.oSrc = o.src;
  if (n.src) r.nSrc = n.src;
  return r;
}

function covers(set: JsonType[], t: JsonType): boolean {
  return set.includes(t) || (t === 'integer' && set.includes('number'));
}

function isArrayish(s: NSchema): boolean {
  return s.types === null || s.types.includes('array');
}

function parseMaybe(s: string | undefined): unknown {
  if (s === undefined) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function isMultiple(a: number, b: number): boolean {
  // relaxed when old multipleOf is a multiple of the new one (every old-valid value stays valid)
  const r = a / b;
  return Math.abs(r - Math.round(r)) < 1e-9;
}

type Bound = { value: number; exclusive: boolean } | undefined;

function numericBound(
  inclusive: number | undefined,
  exclusive: number | undefined,
  side: 'lower' | 'upper',
): Bound {
  const cands: Bound[] = [];
  if (inclusive !== undefined) cands.push({ value: inclusive, exclusive: false });
  if (exclusive !== undefined) cands.push({ value: exclusive, exclusive: true });
  if (cands.length === 0) return undefined;
  return cands.reduce((best, c) => {
    if (!best || !c) return best ?? c;
    const tighter =
      side === 'lower'
        ? c.value > best.value || (c.value === best.value && c.exclusive)
        : c.value < best.value || (c.value === best.value && c.exclusive);
    return tighter ? c : best;
  });
}

function cmpBound(
  keyword: string,
  a: number | undefined,
  b: number | undefined,
  side: 'lower' | 'upper',
  emit: (k: string, tightened: boolean, before: unknown, after: unknown) => void,
) {
  if (a === b) return;
  if (a === undefined) return emit(keyword, true, undefined, b);
  if (b === undefined) return emit(keyword, false, a, undefined);
  const tightened = side === 'upper' ? b < a : b > a;
  emit(keyword, tightened, a, b);
}

function cmpNumeric(
  keyword: string,
  a: Bound,
  b: Bound,
  side: 'lower' | 'upper',
  emit: (k: string, tightened: boolean, before: unknown, after: unknown) => void,
) {
  const show = (x: Bound) =>
    x
      ? `${x.exclusive ? (side === 'lower' ? '>' : '<') : side === 'lower' ? '>=' : '<='} ${x.value}`
      : undefined;
  if (!a && !b) return;
  if (a && b && a.value === b.value && a.exclusive === b.exclusive) return;
  if (!a) return emit(keyword, true, undefined, show(b));
  if (!b) return emit(keyword, false, show(a), undefined);
  const tightened =
    side === 'lower'
      ? b.value > a.value || (b.value === a.value && b.exclusive && !a.exclusive)
      : b.value < a.value || (b.value === a.value && b.exclusive && !a.exclusive);
  emit(keyword, tightened, show(a), show(b));
}

function condChanged(
  cmp: SchemaComparator,
  a: NonNullable<NSchema['combinators']['conditional']>,
  b: NonNullable<NSchema['combinators']['conditional']>,
  pol: SchemaPolarity,
  depth: number,
): boolean {
  for (const k of ['if', 'then', 'else'] as const) {
    const x = a[k];
    const y = b[k];
    if (!!x !== !!y) return true;
    if (x && y && cmp.compare(x, y, pol, depth + 1).some((c) => c.ruleId !== 'SCHEMA_DOCS_CHANGED'))
      return true;
  }
  return false;
}
