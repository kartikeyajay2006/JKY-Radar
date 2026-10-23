/** @import { GraphQLError, GraphQLArgument, GraphQLField, GraphQLInputField, GraphQLNamedType, GraphQLSchema, GraphQLType, IntrospectionQuery, ASTNode } from 'graphql' */
/** @import { Diagnostic, FindingEmitter, ParsedContract, SourceRef } from '@jky/radar-core' */
import {
  buildASTSchema,
  buildClientSchema,
  findBreakingChanges,
  findDangerousChanges,
  getLocation,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  isSpecifiedDirective,
  isSpecifiedScalarType,
  isUnionType,
  parse,
  Source,
  validateSchema,
} from 'graphql';

import { canonicalJson, isObject } from '@jky/radar-core';
import { ContractValidationError } from '../common.js';

/**
 * @typedef {Object} GraphQLModel
 * @property {'graphql'} kind
 * @property {GraphQLSchema} schema
 * @property {'sdl' | 'introspection'} source
 */

const MAX_TOKENS = 250_000;

/**
 * @param {ASTNode | null | undefined} node
 * @returns {SourceRef | undefined}
 */
function locOf(node) {
  if (!node?.loc) return undefined;
  const p = getLocation(node.loc.source, node.loc.start);
  return { line: p.line, column: p.column };
}

/**
 * @param {string} text
 * @returns {ParsedContract<GraphQLModel>}
 */
export function parseGraphQLSdl(text) {
  /** @type {Diagnostic[]} */
  const diagnostics = [];
  const ignored = /** @type {Set<string>} */ (new Set());
  const source = new Source(text, 'schema.graphql');
  /** @type {GraphQLSchema} */
  let schema;
  try {
    const ast = parse(source, { maxTokens: MAX_TOKENS });
    if (ast.definitions.some((d) => d.kind === 'OperationDefinition' || d.kind === 'FragmentDefinition')) {
      throw new ContractValidationError([
        {
          severity: 'error',
          code: 'NOT_A_SCHEMA',
          message: 'The document contains operations/fragments, not a schema definition (SDL).',
        },
      ]);
    }
    try {
      schema = buildASTSchema(ast);
      const errs = validateSchema(schema);
      if (errs.length > 0) throw errs[0];
    } catch (e) {
      const msg = /** @type {Error} */ (e).message;
      if (/Unknown directive|Unknown type "link__Import"|Directive .* may not be used/i.test(msg)) {
        schema = buildASTSchema(ast, { assumeValidSDL: true });
        diagnostics.push({
          severity: 'warning',
          code: 'GRAPHQL_UNDEFINED_DIRECTIVES',
          message: `Schema uses directives that are not defined (e.g. federation). Validation relaxed: ${msg}`,
        });
        ignored.add('Undefined/custom directives (e.g. federation)');
      } else throw e;
    }
  } catch (e) {
    if (e instanceof ContractValidationError) throw e;
    const ge = /** @type {GraphQLError} */ (e);
    const loc = ge.locations?.[0];
    /** @type {Diagnostic} */
    const d = { severity: 'error', code: 'GRAPHQL_SYNTAX', message: ge.message };
    if (loc) d.source = { line: loc.line, column: loc.column };
    throw new ContractValidationError([d]);
  }
  return finishGraphQL(schema, 'sdl', diagnostics, ignored);
}

/**
 * @param {unknown} value
 * @returns {ParsedContract<GraphQLModel>}
 */
export function parseGraphQLIntrospection(value) {
  const v = isObject(value) && isObject(value.data) ? value.data : value;
  if (!isObject(v) || !isObject(v.__schema)) {
    throw new ContractValidationError([
      {
        severity: 'error',
        code: 'NOT_INTROSPECTION',
        message: 'Expected an introspection result with a "__schema" object.',
      },
    ]);
  }
  /** @type {GraphQLSchema} */
  let schema;
  try {
    schema = buildClientSchema(/** @type {IntrospectionQuery} */ (/** @type {unknown} */ (v)));
  } catch (e) {
    throw new ContractValidationError([
      { severity: 'error', code: 'INVALID_INTROSPECTION', message: /** @type {Error} */ (e).message },
    ]);
  }
  /** @type {Diagnostic[]} */
  const diagnostics = [
    {
      severity: 'info',
      code: 'INTROSPECTION_NO_LOCATIONS',
      message: 'Introspection results carry no source locations; findings reference schema coordinates only.',
    },
  ];
  return finishGraphQL(
    schema,
    'introspection',
    diagnostics,
    new Set(['Applied directives (not present in introspection)']),
  );
}

/**
 * @param {GraphQLSchema} schema
 * @returns {GraphQLNamedType[]}
 */
function userTypes(schema) {
  return Object.values(schema.getTypeMap()).filter(
    (t) => !t.name.startsWith('__') && !(isScalarType(t) && isSpecifiedScalarType(t)),
  );
}

/**
 * @param {GraphQLSchema} schema
 * @param {'sdl' | 'introspection'} source
 * @param {Diagnostic[]} diagnostics
 * @param {Set<string>} ignored
 * @returns {ParsedContract<GraphQLModel>}
 */
function finishGraphQL(schema, source, diagnostics, ignored) {
  const types = userTypes(schema);
  let fields = 0;
  for (const t of types)
    if (isObjectType(t) || isInterfaceType(t) || isInputObjectType(t))
      fields += Object.keys(t.getFields()).length;
  if (schema.getDirectives().some((d) => !isSpecifiedDirective(d)))
    ignored.add('Custom directive applications on fields/types');
  return {
    protocol: 'graphql',
    formatVersion: source === 'sdl' ? 'SDL' : 'introspection',
    title: schema.description ?? undefined,
    model: { kind: 'graphql', schema, source },
    diagnostics,
    ignoredConstructs: [...ignored].sort(),
    stats: {
      types: types.length,
      fields,
      queries: Object.keys(schema.getQueryType()?.getFields() ?? {}).length,
      mutations: Object.keys(schema.getMutationType()?.getFields() ?? {}).length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Differ                                                              */
/* ------------------------------------------------------------------ */

/** @param {GraphQLType} t */
const str = (t) => String(t);
/** @param {GraphQLNamedType} t */
const kindOf = (t) =>
  isObjectType(t)
    ? 'object'
    : isInterfaceType(t)
      ? 'interface'
      : isUnionType(t)
        ? 'union'
        : isEnumType(t)
          ? 'enum'
          : isInputObjectType(t)
            ? 'input'
            : 'scalar';

/**
 * Output position: new type must be at least as specific as old (non-null may be added).
 * @param {GraphQLType} oldT
 * @param {GraphQLType} newT
 * @returns {boolean}
 */
function outputSafe(oldT, newT) {
  if (isListType(oldT)) {
    return (
      (isListType(newT) && outputSafe(oldT.ofType, newT.ofType)) ||
      (isNonNullType(newT) && outputSafe(oldT, newT.ofType))
    );
  }
  if (isNonNullType(oldT)) return isNonNullType(newT) && outputSafe(oldT.ofType, newT.ofType);
  return (
    (!isListType(newT) && !isNonNullType(newT) && newT.name === oldT.name) ||
    (isNonNullType(newT) && outputSafe(oldT, newT.ofType))
  );
}

/**
 * Input position: new type must accept every value the old type accepted (non-null may be removed).
 * @param {GraphQLType} oldT
 * @param {GraphQLType} newT
 * @returns {boolean}
 */
function inputSafe(oldT, newT) {
  if (isNonNullType(newT)) return isNonNullType(oldT) && inputSafe(oldT.ofType, newT.ofType);
  const o = isNonNullType(oldT) ? oldT.ofType : oldT;
  if (isListType(newT)) return isListType(o) && inputSafe(o.ofType, newT.ofType);
  return !isListType(o) && !isNonNullType(o) && o.name === newT.name;
}

/**
 * @param {GraphQLModel} a
 * @param {GraphQLModel} b
 * @param {FindingEmitter} emitter
 * @returns {void}
 */
export function diffGraphQL(a, b, emitter) {
  const A = a.schema;
  const B = b.schema;
  /**
   * @param {{ astNode?: ASTNode | null | undefined }} [o]
   * @param {{ astNode?: ASTNode | null | undefined }} [n]
   */
  const srcPair = (o, n) => {
    /** @type {{ baselineSource?: SourceRef; candidateSource?: SourceRef }} */
    const r = {};
    const os = locOf(o?.astNode);
    const ns = locOf(n?.astNode);
    if (os) r.baselineSource = os;
    if (ns) r.candidateSource = ns;
    return r;
  };

  // root operation types
  for (const [label, oT, nT] of /** @type {const} */ ([
    ['query', A.getQueryType(), B.getQueryType()],
    ['mutation', A.getMutationType(), B.getMutationType()],
    ['subscription', A.getSubscriptionType(), B.getSubscriptionType()],
  ])) {
    if (oT && oT.name !== nT?.name) {
      emitter.emit('GQL_ROOT_TYPE_CHANGED', {
        logicalPath: `schema.${label}`,
        entityKey: oT.name,
        message: `Root ${label} type changed from ${oT.name} to ${nT?.name ?? '(none)'}.`,
        before: oT.name,
        after: nT?.name,
      });
    }
  }

  const oldTypes = new Map(userTypes(A).map((t) => [t.name, t]));
  const newTypes = new Map(userTypes(B).map((t) => [t.name, t]));

  for (const [name, ot] of [...oldTypes].sort(([x], [y]) => x.localeCompare(y))) {
    const nt = newTypes.get(name);
    if (!nt) {
      emitter.emit('GQL_TYPE_REMOVED', {
        logicalPath: name,
        entityKey: name,
        message: `Type ${name} (${kindOf(ot)}) was removed.`,
        before: name,
        ...srcPair(ot),
      });
      continue;
    }
    if (kindOf(ot) !== kindOf(nt)) {
      emitter.emit('GQL_TYPE_KIND_CHANGED', {
        logicalPath: name,
        entityKey: name,
        message: `Type ${name} changed kind from ${kindOf(ot)} to ${kindOf(nt)}.`,
        before: kindOf(ot),
        after: kindOf(nt),
        ...srcPair(ot, nt),
      });
      continue;
    }
    if ((ot.description ?? '') !== (nt.description ?? '')) {
      emitter.emit('GQL_DESCRIPTION_CHANGED', {
        logicalPath: name,
        entityKey: name,
        message: `Description of ${name} changed.`,
        before: ot.description,
        after: nt.description,
        ...srcPair(ot, nt),
      });
    }

    if ((isObjectType(ot) || isInterfaceType(ot)) && (isObjectType(nt) || isInterfaceType(nt))) {
      const of = ot.getFields();
      const nf = nt.getFields();
      for (const fname of Object.keys(of).sort()) {
        const f = of[fname];
        const g = nf[fname];
        const coord = `${name}.${fname}`;
        if (!g) {
          emitter.emit('GQL_FIELD_REMOVED', {
            logicalPath: coord,
            entityKey: coord,
            message: `Field ${coord} was removed${f.deprecationReason ? ' (it was deprecated, but removal is still breaking for clients that select it)' : ''}.`,
            before: `${fname}: ${str(f.type)}`,
            ...srcPair(f),
          });
          continue;
        }
        diffOutputField(coord, f, g);
      }
      for (const fname of Object.keys(nf).sort()) {
        if (of[fname]) continue;
        const coord = `${name}.${fname}`;
        emitter.emit('GQL_FIELD_ADDED', {
          logicalPath: coord,
          entityKey: coord,
          message: `Field ${coord}: ${str(nf[fname].type)} was added.`,
          after: `${fname}: ${str(nf[fname].type)}`,
          ...srcPair(undefined, nf[fname]),
        });
      }
      const oi = ot.getInterfaces().map((i) => i.name);
      const ni = nt.getInterfaces().map((i) => i.name);
      for (const i of oi)
        if (!ni.includes(i))
          emitter.emit('GQL_INTERFACE_REMOVED', {
            logicalPath: name,
            entityKey: name,
            message: `${name} no longer implements ${i}.`,
            before: oi,
            after: ni,
            ...srcPair(ot, nt),
          });
      for (const i of ni)
        if (!oi.includes(i))
          emitter.emit('GQL_INTERFACE_ADDED', {
            logicalPath: name,
            entityKey: name,
            message: `${name} now implements ${i}.`,
            before: oi,
            after: ni,
            ...srcPair(ot, nt),
          });
    }

    if (isInputObjectType(ot) && isInputObjectType(nt)) {
      const of = ot.getFields();
      const nf = nt.getFields();
      for (const fname of Object.keys(of).sort()) {
        const f = of[fname];
        const g = nf[fname];
        const coord = `${name}.${fname}`;
        if (!g) {
          emitter.emit('GQL_INPUT_FIELD_REMOVED', {
            logicalPath: coord,
            entityKey: name,
            message: `Input field ${coord} was removed.`,
            before: `${fname}: ${str(f.type)}`,
            ...srcPair(f),
          });
          continue;
        }
        diffInputValue(coord, name, f, g, 'GQL_INPUT_FIELD_TYPE_CHANGED', 'GQL_INPUT_FIELD_TYPE_WIDENED');
      }
      for (const fname of Object.keys(nf).sort()) {
        if (of[fname]) continue;
        const g = nf[fname];
        const required = isNonNullType(g.type) && g.defaultValue === undefined;
        emitter.emit(required ? 'GQL_REQUIRED_INPUT_FIELD_ADDED' : 'GQL_OPTIONAL_INPUT_FIELD_ADDED', {
          logicalPath: `${name}.${fname}`,
          entityKey: name,
          message: `${required ? 'Required' : 'Optional'} input field ${name}.${fname}: ${str(g.type)} was added.`,
          after: `${fname}: ${str(g.type)}`,
          ...srcPair(undefined, g),
        });
      }
    }

    if (isEnumType(ot) && isEnumType(nt)) {
      const ov = new Map(ot.getValues().map((v) => [v.name, v]));
      const nv = new Map(nt.getValues().map((v) => [v.name, v]));
      for (const [vn, v] of ov) {
        const w = nv.get(vn);
        if (!w)
          emitter.emit('GQL_ENUM_VALUE_REMOVED', {
            logicalPath: `${name}.${vn}`,
            entityKey: name,
            message: `Enum value ${name}.${vn} was removed.`,
            before: vn,
            ...srcPair(v),
          });
        else if (!v.deprecationReason && w.deprecationReason) {
          emitter.emit('GQL_ENUM_VALUE_DEPRECATED', {
            logicalPath: `${name}.${vn}`,
            entityKey: name,
            message: `Enum value ${name}.${vn} is now deprecated: ${w.deprecationReason}`,
            after: w.deprecationReason,
            ...srcPair(v, w),
          });
        }
      }
      for (const [vn, w] of nv)
        if (!ov.has(vn))
          emitter.emit('GQL_ENUM_VALUE_ADDED', {
            logicalPath: `${name}.${vn}`,
            entityKey: name,
            message: `Enum value ${name}.${vn} was added.`,
            after: vn,
            ...srcPair(undefined, w),
          });
    }

    if (isUnionType(ot) && isUnionType(nt)) {
      const om = ot.getTypes().map((t) => t.name);
      const nm = nt.getTypes().map((t) => t.name);
      for (const m of om)
        if (!nm.includes(m))
          emitter.emit('GQL_UNION_MEMBER_REMOVED', {
            logicalPath: name,
            entityKey: name,
            message: `${m} was removed from union ${name}.`,
            before: om,
            after: nm,
            ...srcPair(ot, nt),
          });
      for (const m of nm)
        if (!om.includes(m))
          emitter.emit('GQL_UNION_MEMBER_ADDED', {
            logicalPath: name,
            entityKey: name,
            message: `${m} was added to union ${name}.`,
            before: om,
            after: nm,
            ...srcPair(ot, nt),
          });
    }
  }
  for (const [name, nt] of [...newTypes].sort(([x], [y]) => x.localeCompare(y))) {
    if (!oldTypes.has(name))
      emitter.emit('GQL_TYPE_ADDED', {
        logicalPath: name,
        entityKey: name,
        message: `Type ${name} (${kindOf(nt)}) was added.`,
        after: name,
        ...srcPair(undefined, nt),
      });
  }

  // directives
  const od = new Map(
    A.getDirectives()
      .filter((d) => !isSpecifiedDirective(d))
      .map((d) => [d.name, d]),
  );
  const nd = new Map(
    B.getDirectives()
      .filter((d) => !isSpecifiedDirective(d))
      .map((d) => [d.name, d]),
  );
  for (const [dn, d] of od) {
    const e = nd.get(dn);
    if (!e) {
      emitter.emit('GQL_DIRECTIVE_REMOVED', {
        logicalPath: `@${dn}`,
        entityKey: `@${dn}`,
        message: `Directive @${dn} was removed.`,
        before: `@${dn}`,
        ...srcPair(d),
      });
      continue;
    }
    const lostLocations = d.locations.filter((l) => !e.locations.includes(l));
    const lostArgs = d.args.filter((x) => !e.args.some((y) => y.name === x.name)).map((x) => x.name);
    const newRequired = e.args
      .filter(
        (y) =>
          !d.args.some((x) => x.name === y.name) && isNonNullType(y.type) && y.defaultValue === undefined,
      )
      .map((y) => y.name);
    const repeatableLost = d.isRepeatable && !e.isRepeatable;
    if (lostLocations.length || lostArgs.length || newRequired.length || repeatableLost) {
      emitter.emit('GQL_DIRECTIVE_CHANGED', {
        logicalPath: `@${dn}`,
        entityKey: `@${dn}`,
        message: `Directive @${dn} changed:${lostLocations.length ? ` locations removed ${lostLocations.join(', ')};` : ''}${lostArgs.length ? ` arguments removed ${lostArgs.join(', ')};` : ''}${newRequired.length ? ` required arguments added ${newRequired.join(', ')};` : ''}${repeatableLost ? ' no longer repeatable;' : ''}`,
        before: { locations: d.locations, args: d.args.map((x) => x.name), repeatable: d.isRepeatable },
        after: { locations: e.locations, args: e.args.map((x) => x.name), repeatable: e.isRepeatable },
        ...srcPair(d, e),
      });
    }
  }
  for (const [dn, e] of nd)
    if (!od.has(dn))
      emitter.emit('GQL_DIRECTIVE_ADDED', {
        logicalPath: `@${dn}`,
        entityKey: `@${dn}`,
        message: `Directive @${dn} was added.`,
        after: `@${dn}`,
        ...srcPair(undefined, e),
      });

  // Safety net: anything graphql-js flags that our rules did not classify.
  const ours = emitter.findings();
  /** @param {string} s */
  const tokens = (s) => new Set(s.match(/[_A-Za-z][_0-9A-Za-z]*/g) ?? []);
  /** @param {string} desc */
  const covered = (desc) => {
    const dt = tokens(desc);
    return ours.some(
      (f) =>
        f.severity !== 'informational' &&
        f.severity !== 'non_breaking' &&
        [...tokens(f.logicalPath)].every((t) => dt.has(t)),
    );
  };
  for (const c of [...findBreakingChanges(A, B), ...findDangerousChanges(A, B)]) {
    if (covered(c.description)) continue;
    emitter.emit('GQL_UPSTREAM_UNMATCHED', {
      logicalPath: `graphql-js:${c.type}`,
      message: `${c.type}: ${c.description}`,
      before: c.type,
      after: c.description,
    });
  }

  /**
   * @param {string} coord
   * @param {GraphQLField<unknown, unknown>} f
   * @param {GraphQLField<unknown, unknown>} g
   */
  function diffOutputField(coord, f, g) {
    const sp = srcPair(f, g);
    if (str(f.type) !== str(g.type)) {
      if (outputSafe(f.type, g.type)) {
        emitter.emit('GQL_FIELD_TYPE_NARROWED', {
          logicalPath: coord,
          entityKey: coord,
          message: `${coord} type narrowed from ${str(f.type)} to ${str(g.type)}.`,
          before: str(f.type),
          after: str(g.type),
          ...sp,
        });
      } else if (isNonNullType(f.type) && str(f.type.ofType) === str(g.type)) {
        emitter.emit('GQL_OUTPUT_FIELD_BECAME_NULLABLE', {
          logicalPath: coord,
          entityKey: coord,
          message: `${coord} changed from ${str(f.type)} to nullable ${str(g.type)}.`,
          before: str(f.type),
          after: str(g.type),
          ...sp,
        });
      } else {
        emitter.emit('GQL_FIELD_TYPE_CHANGED', {
          logicalPath: coord,
          entityKey: coord,
          message: `${coord} type changed from ${str(f.type)} to ${str(g.type)}.`,
          before: str(f.type),
          after: str(g.type),
          ...sp,
        });
      }
    }
    if (!f.deprecationReason && g.deprecationReason) {
      emitter.emit('GQL_FIELD_DEPRECATED', {
        logicalPath: coord,
        entityKey: coord,
        message: `${coord} is now deprecated: ${g.deprecationReason}. It still exists.`,
        after: g.deprecationReason,
        ...sp,
      });
    }
    if ((f.description ?? '') !== (g.description ?? '')) {
      emitter.emit('GQL_DESCRIPTION_CHANGED', {
        logicalPath: coord,
        entityKey: coord,
        message: `Description of ${coord} changed.`,
        before: f.description,
        after: g.description,
        ...sp,
      });
    }
    const oa = new Map(f.args.map((x) => [x.name, x]));
    const na = new Map(g.args.map((x) => [x.name, x]));
    for (const [an, x] of oa) {
      const y = na.get(an);
      if (!y) {
        emitter.emit('GQL_ARG_REMOVED', {
          logicalPath: `${coord}(${an}:)`,
          entityKey: coord,
          message: `Argument ${an} was removed from ${coord}.`,
          before: `${an}: ${str(x.type)}`,
          ...srcPair(x),
        });
        continue;
      }
      diffInputValue(`${coord}(${an}:)`, coord, x, y, 'GQL_ARG_TYPE_CHANGED', 'GQL_ARG_TYPE_WIDENED');
      if (canonicalJson(x.defaultValue) !== canonicalJson(y.defaultValue)) {
        emitter.emit('GQL_ARG_DEFAULT_CHANGED', {
          logicalPath: `${coord}(${an}:)`,
          entityKey: coord,
          message: `Default of ${coord}(${an}:) changed from ${canonicalJson(x.defaultValue)} to ${canonicalJson(y.defaultValue)}.`,
          before: x.defaultValue,
          after: y.defaultValue,
          ...srcPair(x, y),
        });
      }
    }
    for (const [an, y] of na) {
      if (oa.has(an)) continue;
      const required = isNonNullType(y.type) && y.defaultValue === undefined;
      emitter.emit(required ? 'GQL_REQUIRED_ARG_ADDED' : 'GQL_OPTIONAL_ARG_ADDED', {
        logicalPath: `${coord}(${an}:)`,
        entityKey: coord,
        message: `${required ? 'Required' : 'Optional'} argument ${an}: ${str(y.type)} was added to ${coord}.`,
        after: `${an}: ${str(y.type)}`,
        ...srcPair(undefined, y),
      });
    }
  }

  /**
   * @param {string} coord
   * @param {string} entityKey
   * @param {GraphQLArgument | GraphQLInputField} x
   * @param {GraphQLArgument | GraphQLInputField} y
   * @param {string} breakingRule
   * @param {string} wideningRule
   */
  function diffInputValue(coord, entityKey, x, y, breakingRule, wideningRule) {
    if (str(x.type) === str(y.type)) return;
    const safe = inputSafe(x.type, y.type);
    emitter.emit(safe ? wideningRule : breakingRule, {
      logicalPath: coord,
      entityKey,
      message: `${coord} type changed from ${str(x.type)} to ${str(y.type)}${safe ? ' (accepts more values)' : ''}.`,
      before: str(x.type),
      after: str(y.type),
      ...srcPair(x, y),
    });
  }
}
