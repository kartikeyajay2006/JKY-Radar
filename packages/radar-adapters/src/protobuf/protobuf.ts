import protobuf from 'protobufjs';
import type { Diagnostic, FindingEmitter, ParsedContract, SourceRef } from '@jky/radar-core';
import { ContractValidationError } from '../common.js';

type Rule = 'singular' | 'optional' | 'repeated' | 'map' | 'required';

export interface ProtoField {
  name: string;
  number: number;
  type: string;
  typeKind: 'scalar' | 'enum' | 'message' | 'unknown';
  rule: Rule;
  keyType?: string;
  oneof?: string;
  src?: SourceRef;
}
export interface ProtoMessage {
  name: string;
  fields: ProtoField[];
  reservedRanges: Array<[number, number]>;
  reservedNames: string[];
  src?: SourceRef;
}
export interface ProtoEnum {
  name: string;
  values: Record<string, number>;
  reservedRanges: Array<[number, number]>;
  reservedNames: string[];
  src?: SourceRef;
}
export interface ProtoMethod {
  name: string;
  requestType: string;
  responseType: string;
  requestStream: boolean;
  responseStream: boolean;
  src?: SourceRef;
}
export interface ProtoService {
  name: string;
  methods: Record<string, ProtoMethod>;
  src?: SourceRef;
}
export interface ProtoModel {
  kind: 'grpc';
  package: string;
  syntax: string;
  services: Record<string, ProtoService>;
  messages: Record<string, ProtoMessage>;
  enums: Record<string, ProtoEnum>;
}

const SCALARS = new Set([
  'double',
  'float',
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'bool',
  'string',
  'bytes',
]);

/** Wire-compatible groups per the protobuf language guide. */
const WIRE_GROUP: Record<string, string> = {
  int32: 'varint',
  uint32: 'varint',
  int64: 'varint',
  uint64: 'varint',
  bool: 'varint',
  enum: 'varint',
  sint32: 'zigzag',
  sint64: 'zigzag',
  fixed32: 'i32',
  sfixed32: 'i32',
  fixed64: 'i64',
  sfixed64: 'i64',
  string: 'len',
  bytes: 'len',
  float: 'float',
  double: 'double',
};

function lineFinder(text: string) {
  const lines = text.split('\n');
  return (re: RegExp): SourceRef | undefined => {
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]!);
      if (m) return { line: i + 1, column: (m.index ?? 0) + 1 };
    }
    return undefined;
  };
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function parseProto(text: string): ParsedContract<ProtoModel> {
  const diagnostics: Diagnostic[] = [];
  const ignored = new Set<string>();
  let parsed: protobuf.IParserResult;
  try {
    parsed = protobuf.parse(text, { keepCase: true, alternateCommentMode: true });
  } catch (e) {
    const msg = (e as Error).message;
    const line = /line (\d+)/.exec(msg)?.[1];
    const d: Diagnostic = { severity: 'error', code: 'PROTO_SYNTAX', message: msg };
    if (line) d.source = { line: Number(line) };
    throw new ContractValidationError([d]);
  }
  const find = lineFinder(text);
  const edition = /^\s*edition\s*=\s*["']([^"']+)["']/m.exec(text)?.[1];
  const syntax = edition
    ? `edition ${edition}`
    : (/^\s*syntax\s*=\s*["'](proto[23])["']/m.exec(text)?.[1] ?? 'proto2');
  if (edition) {
    diagnostics.push({
      severity: 'warning',
      code: 'PROTO_EDITIONS',
      message: `Protobuf editions (${edition}) feature semantics (field presence, enum openness) are not modelled.`,
    });
    ignored.add('Protobuf editions features');
  }
  if (parsed.imports?.length) {
    ignored.add('Types from imported .proto files (imports are not resolved)');
    diagnostics.push({
      severity: 'info',
      code: 'PROTO_IMPORTS',
      message: `Imports are not resolved: ${parsed.imports.join(', ')}.`,
    });
  }
  if (/\boption\s*\(/.test(text) || /\[\s*\(/.test(text)) ignored.add('Custom options');
  if (/^\s*extend\s+/m.test(text)) ignored.add('extend blocks (proto2 extensions)');

  const pkg = parsed.package ?? '';
  const rel = (full: string) => {
    const f = full.replace(/^\./, '');
    return pkg && f.startsWith(`${pkg}.`) ? f.slice(pkg.length + 1) : f;
  };
  const model: ProtoModel = { kind: 'grpc', package: pkg, syntax, services: {}, messages: {}, enums: {} };

  const splitReserved = (reserved: Array<number[] | string> | undefined) => {
    const ranges: Array<[number, number]> = [];
    const names: string[] = [];
    for (const r of reserved ?? []) {
      if (typeof r === 'string') names.push(r);
      else if (Array.isArray(r)) ranges.push([r[0]!, r[1] ?? r[0]!]);
    }
    return { ranges, names };
  };

  const visit = (ns: protobuf.NamespaceBase) => {
    for (const obj of ns.nestedArray) {
      if (obj instanceof protobuf.Type) {
        const name = rel(obj.fullName);
        const short = name.split('.').pop()!;
        const res = splitReserved(obj.reserved as Array<number[] | string> | undefined);
        const msg: ProtoMessage = { name, fields: [], reservedRanges: res.ranges, reservedNames: res.names };
        const src = find(new RegExp(`\\bmessage\\s+${esc(short)}\\b`));
        if (src) msg.src = src;
        for (const f of obj.fieldsArray) {
          let typeKind: ProtoField['typeKind'] = 'scalar';
          let typeName = f.type;
          if (!SCALARS.has(f.type)) {
            const found = obj.lookup(f.type, [protobuf.Type, protobuf.Enum]);
            if (found instanceof protobuf.Enum) typeKind = 'enum';
            else if (found instanceof protobuf.Type) typeKind = 'message';
            else typeKind = 'unknown';
            typeName = found ? rel(found.fullName) : f.type.replace(/^\./, '');
          }
          const isMap = f instanceof protobuf.MapField;
          const synthetic = f.partOf && f.partOf.name === `_${f.name}`;
          let rule: Rule = 'singular';
          const label = (f as unknown as { rule?: string }).rule;
          if (isMap) rule = 'map';
          else if (label === 'repeated' || f.repeated) rule = 'repeated';
          else if (label === 'required' || f.required) rule = 'required';
          else if (syntax === 'proto2' || synthetic || f.options?.proto3_optional) rule = 'optional';
          const field: ProtoField = { name: f.name, number: f.id, type: typeName, typeKind, rule };
          if (isMap) field.keyType = (f as protobuf.MapField).keyType;
          if (f.partOf && !synthetic) field.oneof = f.partOf.name;
          const fs = find(new RegExp(`\\b${esc(f.name)}\\s*=\\s*${f.id}\\b`));
          if (fs) field.src = fs;
          msg.fields.push(field);
        }
        msg.fields.sort((a, b) => a.number - b.number);
        model.messages[name] = msg;
        visit(obj);
      } else if (obj instanceof protobuf.Enum) {
        const name = rel(obj.fullName);
        const short = name.split('.').pop()!;
        const res = splitReserved(obj.reserved as Array<number[] | string> | undefined);
        const en: ProtoEnum = {
          name,
          values: { ...obj.values },
          reservedRanges: res.ranges,
          reservedNames: res.names,
        };
        const src = find(new RegExp(`\\benum\\s+${esc(short)}\\b`));
        if (src) en.src = src;
        model.enums[name] = en;
      } else if (obj instanceof protobuf.Service) {
        const name = rel(obj.fullName);
        const svc: ProtoService = { name, methods: {} };
        const src = find(new RegExp(`\\bservice\\s+${esc(obj.name)}\\b`));
        if (src) svc.src = src;
        for (const m of obj.methodsArray) {
          const req = obj.lookup(m.requestType, [protobuf.Type]);
          const resp = obj.lookup(m.responseType, [protobuf.Type]);
          const method: ProtoMethod = {
            name: m.name,
            requestType: req ? rel(req.fullName) : m.requestType,
            responseType: resp ? rel(resp.fullName) : m.responseType,
            requestStream: !!m.requestStream,
            responseStream: !!m.responseStream,
          };
          const ms = find(new RegExp(`\\brpc\\s+${esc(m.name)}\\b`));
          if (ms) method.src = ms;
          svc.methods[m.name] = method;
        }
        model.services[name] = svc;
      } else if (obj instanceof protobuf.Namespace) {
        visit(obj);
      }
    }
  };
  visit(parsed.root);

  return {
    protocol: 'grpc',
    formatVersion: syntax,
    title: pkg || undefined,
    model,
    diagnostics,
    ignoredConstructs: [...ignored].sort(),
    stats: {
      services: Object.keys(model.services).length,
      methods: Object.values(model.services).reduce((n, s) => n + Object.keys(s.methods).length, 0),
      messages: Object.keys(model.messages).length,
      enums: Object.keys(model.enums).length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Differ                                                              */
/* ------------------------------------------------------------------ */

const inRanges = (n: number, ranges: Array<[number, number]>) => ranges.some(([a, b]) => n >= a && n <= b);

export function diffProto(
  a: ProtoModel,
  b: ProtoModel,
  emitter: FindingEmitter,
  editionsUsed: boolean,
): void {
  const fq = (name: string) => (a.package ? `${a.package}.${name}` : name);
  const s = (o?: { src?: SourceRef }, n?: { src?: SourceRef }) => ({
    ...(o?.src ? { baselineSource: o.src } : {}),
    ...(n?.src ? { candidateSource: n.src } : {}),
  });
  if (editionsUsed) {
    emitter.emit('PROTO_SYNTAX_UNSUPPORTED', {
      logicalPath: 'syntax',
      message: `Editions syntax (${a.syntax} → ${b.syntax}) is parsed but its feature semantics are not analysed.`,
      before: a.syntax,
      after: b.syntax,
      tags: ['coverage-gap'],
    });
  }
  if (a.package !== b.package) {
    emitter.emit('PROTO_PACKAGE_CHANGED', {
      logicalPath: 'package',
      entityKey: a.package,
      message: `Package changed from "${a.package}" to "${b.package}"; every fully-qualified name and gRPC path changes.`,
      before: a.package,
      after: b.package,
    });
  }

  for (const [name, svc] of Object.entries(a.services)) {
    const other = b.services[name];
    if (!other) {
      emitter.emit('PROTO_SERVICE_REMOVED', {
        logicalPath: `service ${name}`,
        entityKey: fq(name),
        message: `Service ${fq(name)} was removed.`,
        before: name,
        ...s(svc),
      });
      continue;
    }
    for (const [mn, m] of Object.entries(svc.methods)) {
      const key = `${fq(name)}/${mn}`;
      const n = other.methods[mn];
      if (!n) {
        emitter.emit('PROTO_RPC_REMOVED', {
          logicalPath: `rpc ${name}.${mn}`,
          entityKey: key,
          message: `RPC ${key} was removed.`,
          before: mn,
          ...s(m),
        });
        continue;
      }
      if (m.requestType !== n.requestType)
        emitter.emit('PROTO_RPC_REQUEST_TYPE_CHANGED', {
          logicalPath: `rpc ${name}.${mn}`,
          entityKey: key,
          message: `${key} request type changed from ${m.requestType} to ${n.requestType}.`,
          before: m.requestType,
          after: n.requestType,
          ...s(m, n),
        });
      if (m.responseType !== n.responseType)
        emitter.emit('PROTO_RPC_RESPONSE_TYPE_CHANGED', {
          logicalPath: `rpc ${name}.${mn}`,
          entityKey: key,
          message: `${key} response type changed from ${m.responseType} to ${n.responseType}.`,
          before: m.responseType,
          after: n.responseType,
          ...s(m, n),
        });
      if (m.requestStream !== n.requestStream || m.responseStream !== n.responseStream) {
        const mode = (x: ProtoMethod) =>
          `${x.requestStream ? 'stream ' : ''}request → ${x.responseStream ? 'stream ' : ''}response`;
        emitter.emit('PROTO_RPC_STREAMING_CHANGED', {
          logicalPath: `rpc ${name}.${mn}`,
          entityKey: key,
          message: `${key} streaming changed: ${mode(m)} ⇒ ${mode(n)}.`,
          before: mode(m),
          after: mode(n),
          ...s(m, n),
        });
      }
    }
    for (const [mn, n] of Object.entries(other.methods)) {
      if (!svc.methods[mn])
        emitter.emit('PROTO_RPC_ADDED', {
          logicalPath: `rpc ${name}.${mn}`,
          entityKey: `${fq(name)}/${mn}`,
          message: `RPC ${fq(name)}/${mn} was added.`,
          after: mn,
          ...s(undefined, n),
        });
    }
  }
  for (const [name, svc] of Object.entries(b.services)) {
    if (!a.services[name])
      emitter.emit('PROTO_SERVICE_ADDED', {
        logicalPath: `service ${name}`,
        entityKey: fq(name),
        message: `Service ${name} was added.`,
        after: name,
        ...s(undefined, svc),
      });
  }

  for (const [name, m] of Object.entries(a.messages)) {
    const n = b.messages[name];
    if (!n) {
      emitter.emit('PROTO_MESSAGE_REMOVED', {
        logicalPath: `message ${name}`,
        entityKey: fq(name),
        message: `Message ${name} was removed.`,
        before: name,
        ...s(m),
      });
      continue;
    }
    diffMessage(name, m, n);
  }
  for (const [name, e] of Object.entries(a.enums)) {
    const f = b.enums[name];
    if (f) diffEnum(name, e, f);
  }

  function diffMessage(name: string, m: ProtoMessage, n: ProtoMessage) {
    const ent = fq(name);
    const byNum = new Map(n.fields.map((f) => [f.number, f]));
    const byName = new Map(n.fields.map((f) => [f.name, f]));
    const oldNums = new Set(m.fields.map((f) => f.number));
    for (const f of m.fields) {
      const g = byNum.get(f.number);
      const lp = `${name}.${f.name} = ${f.number}`;
      if (!g) {
        const moved = byName.get(f.name);
        if (moved) {
          emitter.emit('PROTO_FIELD_NUMBER_CHANGED', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field ${name}.${f.name} changed number from ${f.number} to ${moved.number}.`,
            before: f.number,
            after: moved.number,
            ...s(f, moved),
          });
        } else {
          const reserved = inRanges(f.number, n.reservedRanges) || n.reservedNames.includes(f.name);
          emitter.emit(reserved ? 'PROTO_FIELD_REMOVED' : 'PROTO_FIELD_REMOVED_UNRESERVED', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field ${name}.${f.name} (#${f.number}) was removed${reserved ? ' and reserved' : ' without reserving its number/name'}.`,
            before: `${f.type} ${f.name} = ${f.number}`,
            ...s(f, n),
          });
        }
        continue;
      }
      const sameType = f.type === g.type && f.typeKind === g.typeKind;
      if (f.name !== g.name) {
        if (sameType && f.rule === g.rule) {
          emitter.emit('PROTO_FIELD_RENAMED', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field #${f.number} renamed from ${f.name} to ${g.name} (wire-compatible; source and JSON break).`,
            before: f.name,
            after: g.name,
            ...s(f, g),
          });
        } else {
          emitter.emit('PROTO_FIELD_NUMBER_REUSED', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field number ${f.number} now identifies ${g.type} ${g.name} instead of ${f.type} ${f.name}.`,
            before: `${f.type} ${f.name}`,
            after: `${g.type} ${g.name}`,
            ...s(f, g),
          });
          continue;
        }
      }
      if (!sameType) {
        const ga = f.typeKind === 'enum' ? 'enum' : f.type;
        const gb = g.typeKind === 'enum' ? 'enum' : g.type;
        if (f.typeKind === 'message' && g.typeKind === 'message') {
          emitter.emit('PROTO_FIELD_MESSAGE_TYPE_CHANGED', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field ${name}.${g.name} message type changed from ${f.type} to ${g.type}.`,
            before: f.type,
            after: g.type,
            ...s(f, g),
          });
        } else if (
          (WIRE_GROUP[ga] && WIRE_GROUP[ga] === WIRE_GROUP[gb]) ||
          (f.typeKind === 'message' && g.type === 'bytes') ||
          (f.type === 'bytes' && g.typeKind === 'message')
        ) {
          emitter.emit('PROTO_FIELD_TYPE_CHANGED_COMPATIBLE', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field ${name}.${g.name} changed from ${f.type} to ${g.type} (same wire encoding; values may truncate or be reinterpreted).`,
            before: f.type,
            after: g.type,
            ...s(f, g),
          });
        } else {
          emitter.emit('PROTO_FIELD_WIRE_TYPE_CHANGED', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field ${name}.${g.name} changed from ${f.type} to ${g.type}, an incompatible wire encoding.`,
            before: f.type,
            after: g.type,
            ...s(f, g),
          });
        }
      }
      if (f.rule !== g.rule) {
        if (f.rule === 'required' || g.rule === 'required') {
          emitter.emit('PROTO_FIELD_REQUIRED_CHANGED', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field ${name}.${g.name} label changed from ${f.rule} to ${g.rule}.`,
            before: f.rule,
            after: g.rule,
            ...s(f, g),
          });
        } else {
          emitter.emit('PROTO_FIELD_CARDINALITY_CHANGED', {
            logicalPath: lp,
            entityKey: ent,
            message: `Field ${name}.${g.name} cardinality changed from ${f.rule} to ${g.rule}.`,
            before: f.rule,
            after: g.rule,
            ...s(f, g),
          });
        }
      }
      if ((f.oneof ?? '') !== (g.oneof ?? '')) {
        emitter.emit('PROTO_ONEOF_CHANGED', {
          logicalPath: lp,
          entityKey: ent,
          message: `Field ${name}.${g.name} oneof membership changed from ${f.oneof ?? '(none)'} to ${g.oneof ?? '(none)'}.`,
          before: f.oneof ?? null,
          after: g.oneof ?? null,
          ...s(f, g),
        });
      }
    }
    for (const g of n.fields) {
      if (oldNums.has(g.number)) continue;
      if (m.fields.some((f) => f.name === g.name)) continue; // number change already reported
      if (inRanges(g.number, m.reservedRanges) || m.reservedNames.includes(g.name)) {
        emitter.emit('PROTO_FIELD_NUMBER_REUSED', {
          logicalPath: `${name}.${g.name} = ${g.number}`,
          entityKey: ent,
          message: `Field ${g.name} uses ${inRanges(g.number, m.reservedRanges) ? `reserved number ${g.number}` : 'a reserved name'}.`,
          after: `${g.type} ${g.name} = ${g.number}`,
          ...s(m, g),
        });
      } else {
        emitter.emit('PROTO_FIELD_ADDED', {
          logicalPath: `${name}.${g.name} = ${g.number}`,
          entityKey: ent,
          message: `Field ${name}.${g.name} (#${g.number}) was added.`,
          after: `${g.type} ${g.name} = ${g.number}`,
          ...s(undefined, g),
        });
      }
    }
    const lostRanges = m.reservedRanges.filter(
      ([x, y]) => !n.reservedRanges.some(([p, q]) => p <= x && q >= y),
    );
    const lostNames = m.reservedNames.filter((x) => !n.reservedNames.includes(x));
    if (lostRanges.length || lostNames.length) {
      emitter.emit('PROTO_RESERVED_REMOVED', {
        logicalPath: `${name} reserved`,
        entityKey: ent,
        message: `Reservations removed from ${name}: ${[...lostRanges.map(([x, y]) => (x === y ? `${x}` : `${x} to ${y}`)), ...lostNames.map((x) => `"${x}"`)].join(', ')}.`,
        before: { ranges: m.reservedRanges, names: m.reservedNames },
        after: { ranges: n.reservedRanges, names: n.reservedNames },
        ...s(m, n),
      });
    }
  }

  function diffEnum(name: string, e: ProtoEnum, f: ProtoEnum) {
    const ent = fq(name);
    const byNumberNew = new Map<number, string>();
    for (const [k, v] of Object.entries(f.values)) if (!byNumberNew.has(v)) byNumberNew.set(v, k);
    for (const [k, v] of Object.entries(e.values)) {
      const nv = f.values[k];
      if (nv === undefined) {
        const reuser = byNumberNew.get(v);
        if (reuser && !(reuser in e.values)) {
          emitter.emit('PROTO_ENUM_NUMBER_REUSED', {
            logicalPath: `${name}.${k}`,
            entityKey: ent,
            message: `Enum number ${v} moved from ${k} to ${reuser}.`,
            before: `${k} = ${v}`,
            after: `${reuser} = ${v}`,
            ...s(e, f),
          });
        } else {
          emitter.emit('PROTO_ENUM_VALUE_REMOVED', {
            logicalPath: `${name}.${k}`,
            entityKey: ent,
            message: `Enum value ${name}.${k} (= ${v}) was removed.`,
            before: `${k} = ${v}`,
            ...s(e, f),
          });
        }
      } else if (nv !== v) {
        emitter.emit('PROTO_ENUM_VALUE_NUMBER_CHANGED', {
          logicalPath: `${name}.${k}`,
          entityKey: ent,
          message: `Enum value ${name}.${k} changed number from ${v} to ${nv}.`,
          before: v,
          after: nv,
          ...s(e, f),
        });
      }
    }
    const oldNumbers = new Set(Object.values(e.values));
    for (const [k, v] of Object.entries(f.values)) {
      if (k in e.values) continue;
      if (oldNumbers.has(v)) continue; // reported as reuse above
      emitter.emit('PROTO_ENUM_VALUE_ADDED', {
        logicalPath: `${name}.${k}`,
        entityKey: ent,
        message: `Enum value ${name}.${k} = ${v} was added.`,
        after: `${k} = ${v}`,
        ...s(undefined, f),
      });
    }
  }
}
