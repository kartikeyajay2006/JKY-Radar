import type { FindingEmitter, NSchema, ParsedContract, SourceRef } from '@jky/radar-core';
import {
  canonicalJson,
  entries,
  isObject,
  joinPointer,
  normalizeSchema,
  SchemaComparator,
} from '@jky/radar-core';
import type { StructuredDocument } from '../parse/structured.js';
import {
  createAdapterContext,
  error,
  finishContract,
  resolveObject,
  warn,
  type AdapterContext,
} from '../common.js';

export interface AsyncMessage {
  key: string;
  contentType?: string;
  payload?: NSchema;
  headers?: NSchema;
  bindings?: string;
  src?: SourceRef;
}
export interface AsyncOperation {
  key: string;
  /** From the application's perspective. */
  action: 'send' | 'receive';
  channel: string;
  messages: Record<string, AsyncMessage>;
  bindings?: string;
  src?: SourceRef;
}
export interface AsyncModel {
  kind: 'async';
  major: 2 | 3;
  servers: Record<string, { signature: string; src?: SourceRef }>;
  channels: Record<string, { address: string; bindings?: string; src?: SourceRef }>;
  operations: Record<string, AsyncOperation>;
}

export function parseAsyncApi(doc: StructuredDocument): ParsedContract<AsyncModel> {
  const root = doc.value as Record<string, unknown>;
  const version = String(root.asyncapi ?? '');
  const major = version.startsWith('3.') ? 3 : version.startsWith('2.') ? 2 : 0;
  const ctx = createAdapterContext(doc, 'draft7');
  if (!major)
    error(
      ctx,
      'UNSUPPORTED_VERSION',
      `AsyncAPI version "${version}" is not supported (expected 2.x or 3.x).`,
      '/asyncapi',
    );
  warn(
    ctx,
    'ASYNCAPI_EXPERIMENTAL',
    'AsyncAPI support is experimental: channels, operations, messages and payload schemas are compared; bindings and traits are only checked for changes.',
    '/asyncapi',
    'info',
  );
  const defaultContentType =
    typeof root.defaultContentType === 'string' ? root.defaultContentType : undefined;

  const model: AsyncModel = {
    kind: 'async',
    major: major === 3 ? 3 : 2,
    servers: {},
    channels: {},
    operations: {},
  };
  for (const [name, raw] of entries(root.servers)) {
    const r = resolveObject(ctx, raw, joinPointer('/servers', name));
    if (!r) continue;
    const v = r.value;
    const sig = `${String(v.protocol ?? '')}://${String(v.host ?? v.url ?? '')}${String(v.pathname ?? '')}`;
    const src = ctx.locate(r.pointer);
    model.servers[name] = src ? { signature: sig, src } : { signature: sig };
  }

  if (major === 2) {
    for (const [address, raw] of entries(root.channels)) {
      const cp = joinPointer('/channels', address);
      const r = resolveObject(ctx, raw, cp);
      if (!r) continue;
      const ch = r.value;
      const src = ctx.locate(cp);
      model.channels[address] = {
        address,
        ...(ch.bindings ? { bindings: canonicalJson(ch.bindings) } : {}),
        ...(src ? { src } : {}),
      };
      for (const verb of ['publish', 'subscribe'] as const) {
        if (!isObject(ch[verb])) continue;
        const op = ch[verb] as Record<string, unknown>;
        const opPtr = joinPointer(r.pointer, verb);
        const key = typeof op.operationId === 'string' ? op.operationId : `${address}#${verb}`;
        // 2.x: "subscribe" = the application sends; "publish" = the application receives.
        const operation: AsyncOperation = {
          key,
          action: verb === 'subscribe' ? 'send' : 'receive',
          channel: address,
          messages: {},
        };
        const osrc = ctx.locate(opPtr);
        if (osrc) operation.src = osrc;
        if (op.bindings) operation.bindings = canonicalJson(op.bindings);
        if (op.traits) ctx.ignored.add('Operation traits');
        collectMessages2(ctx, op.message, joinPointer(opPtr, 'message'), operation, defaultContentType);
        model.operations[key] = operation;
      }
    }
  } else if (major === 3) {
    const channelAddress = new Map<string, string>();
    for (const [id, raw] of entries(root.channels)) {
      const cp = joinPointer('/channels', id);
      const r = resolveObject(ctx, raw, cp);
      if (!r) continue;
      const ch = r.value;
      const address = typeof ch.address === 'string' ? ch.address : id;
      channelAddress.set(cp, address);
      channelAddress.set(r.pointer, address);
      const src = ctx.locate(cp);
      model.channels[address] = {
        address,
        ...(ch.bindings ? { bindings: canonicalJson(ch.bindings) } : {}),
        ...(src ? { src } : {}),
      };
    }
    for (const [key, raw] of entries(root.operations)) {
      const opPtr = joinPointer('/operations', key);
      const r = resolveObject(ctx, raw, opPtr);
      if (!r) continue;
      const op = r.value;
      const action = op.action === 'send' ? 'send' : op.action === 'receive' ? 'receive' : undefined;
      if (!action) {
        error(ctx, 'INVALID_ACTION', `Operation "${key}" must have action "send" or "receive".`, opPtr);
        continue;
      }
      const chRef =
        isObject(op.channel) && typeof op.channel.$ref === 'string' ? op.channel.$ref.slice(1) : undefined;
      const channel = chRef ? (channelAddress.get(chRef) ?? chRef) : '(unknown)';
      const operation: AsyncOperation = { key, action, channel, messages: {} };
      const osrc = ctx.locate(opPtr);
      if (osrc) operation.src = osrc;
      if (op.bindings) operation.bindings = canonicalJson(op.bindings);
      if (op.traits) ctx.ignored.add('Operation traits');
      if (op.reply) ctx.ignored.add('Operation reply (request/reply) objects');
      let msgRefs: unknown[] = Array.isArray(op.messages) ? op.messages : [];
      if (msgRefs.length === 0 && chRef) {
        const chObj = resolveObject(ctx, { $ref: `#${chRef}` }, opPtr);
        if (chObj && isObject(chObj.value.messages))
          msgRefs = Object.keys(chObj.value.messages).map((m) => ({
            $ref: `#${joinPointer(chObj.pointer, 'messages', m)}`,
          }));
      }
      msgRefs.forEach((m, i) => {
        const mr = resolveObject(ctx, m, joinPointer(opPtr, 'messages', i));
        if (!mr) return;
        const name = isObject(m) && typeof m.$ref === 'string' ? m.$ref.split('/').pop()! : `message${i}`;
        operation.messages[name] = buildMessage(ctx, name, mr.value, mr.pointer, defaultContentType, 3);
      });
      model.operations[key] = operation;
    }
  }
  const comps = isObject(root.components) ? root.components : {};
  return finishContract(ctx, {
    protocol: 'asyncapi',
    formatVersion: version,
    title: isObject(root.info) && typeof root.info.title === 'string' ? root.info.title : undefined,
    version: isObject(root.info) && typeof root.info.version === 'string' ? root.info.version : undefined,
    model,
    stats: {
      channels: Object.keys(model.channels).length,
      operations: Object.keys(model.operations).length,
      messages: isObject(comps.messages) ? Object.keys(comps.messages).length : 0,
    },
  });
}

function collectMessages2(
  ctx: AdapterContext,
  raw: unknown,
  ptr: string,
  op: AsyncOperation,
  dct: string | undefined,
) {
  const r = resolveObject(ctx, raw, ptr);
  if (!r) return;
  if (Array.isArray(r.value.oneOf)) {
    (r.value.oneOf as unknown[]).forEach((m, i) =>
      collectMessages2(ctx, m, joinPointer(r.pointer, 'oneOf', i), op, dct),
    );
    return;
  }
  const v = r.value;
  const name =
    (typeof v.messageId === 'string' && v.messageId) ||
    (typeof v.name === 'string' && v.name) ||
    (isObject(raw) && typeof raw.$ref === 'string'
      ? raw.$ref.split('/').pop()!
      : `message${Object.keys(op.messages).length}`);
  op.messages[name] = buildMessage(ctx, name, v, r.pointer, dct, 2);
}

function buildMessage(
  ctx: AdapterContext,
  key: string,
  v: Record<string, unknown>,
  ptr: string,
  dct: string | undefined,
  major: 2 | 3,
): AsyncMessage {
  const msg: AsyncMessage = { key };
  const ct = typeof v.contentType === 'string' ? v.contentType : dct;
  if (ct) msg.contentType = ct;
  let payload: unknown = v.payload;
  let payloadPtr = joinPointer(ptr, 'payload');
  const schemaFormat =
    major === 2 ? v.schemaFormat : isObject(v.payload) ? v.payload.schemaFormat : undefined;
  if (major === 3 && isObject(v.payload) && 'schemaFormat' in v.payload) {
    payload = v.payload.schema;
    payloadPtr = joinPointer(ptr, 'payload', 'schema');
  }
  if (typeof schemaFormat === 'string' && !/json|asyncapi/i.test(schemaFormat)) {
    ctx.ignored.add(`Non-JSON payload schema formats (${schemaFormat})`);
  } else if (payload !== undefined) {
    msg.payload = normalizeSchema(payload, payloadPtr, ctx.schemaCtx);
  }
  if (v.headers !== undefined)
    msg.headers = normalizeSchema(v.headers, joinPointer(ptr, 'headers'), ctx.schemaCtx);
  if (v.bindings) msg.bindings = canonicalJson(v.bindings);
  if (v.traits) ctx.ignored.add('Message traits');
  const src = ctx.locate(ptr);
  if (src) msg.src = src;
  return msg;
}

export function diffAsyncApi(a: AsyncModel, b: AsyncModel, emitter: FindingEmitter): void {
  const cmp = new SchemaComparator();
  const s = (o?: { src?: SourceRef }, n?: { src?: SourceRef }) => ({
    ...(o?.src ? { baselineSource: o.src } : {}),
    ...(n?.src ? { candidateSource: n.src } : {}),
  });
  for (const [name, sv] of Object.entries(a.servers)) {
    const other = b.servers[name];
    if (!other || other.signature !== sv.signature) {
      emitter.emit('ASYNC_SERVER_CHANGED', {
        logicalPath: `server ${name}`,
        message: other
          ? `Server ${name} changed from ${sv.signature} to ${other.signature}.`
          : `Server ${name} (${sv.signature}) was removed.`,
        before: sv.signature,
        after: other?.signature,
        ...s(sv, other),
      });
    }
  }
  for (const [addr, ch] of Object.entries(a.channels)) {
    const n = b.channels[addr];
    if (!n) {
      emitter.emit('ASYNC_CHANNEL_REMOVED', {
        logicalPath: `channel ${addr}`,
        entityKey: addr,
        message: `Channel ${addr} was removed.`,
        before: addr,
        ...s(ch),
      });
      continue;
    }
    if ((ch.bindings ?? '') !== (n.bindings ?? '')) {
      emitter.emit('ASYNC_BINDINGS_CHANGED', {
        logicalPath: `channel ${addr} › bindings`,
        entityKey: addr,
        message: `Channel bindings for ${addr} changed.`,
        tags: ['coverage-gap'],
        ...s(ch, n),
      });
    }
  }
  for (const [addr, ch] of Object.entries(b.channels)) {
    if (!a.channels[addr])
      emitter.emit('ASYNC_CHANNEL_ADDED', {
        logicalPath: `channel ${addr}`,
        entityKey: addr,
        message: `Channel ${addr} was added.`,
        after: addr,
        ...s(undefined, ch),
      });
  }
  for (const [key, op] of Object.entries(a.operations)) {
    const n = b.operations[key];
    const lp = `operation ${key}`;
    if (!n) {
      if (a.channels[op.channel] && !b.channels[op.channel]) continue; // covered by channel removal
      emitter.emit('ASYNC_OPERATION_REMOVED', {
        logicalPath: lp,
        entityKey: op.channel,
        message: `Operation ${key} (${op.action} on ${op.channel}) was removed.`,
        before: `${op.action} ${op.channel}`,
        ...s(op),
      });
      continue;
    }
    if (op.action !== n.action) {
      emitter.emit('ASYNC_OPERATION_ACTION_CHANGED', {
        logicalPath: lp,
        entityKey: op.channel,
        message: `Operation ${key} changed direction from ${op.action} to ${n.action}.`,
        before: op.action,
        after: n.action,
        ...s(op, n),
      });
      continue;
    }
    if (op.channel !== n.channel) {
      emitter.emit('ASYNC_OPERATION_CHANNEL_CHANGED', {
        logicalPath: lp,
        entityKey: op.channel,
        message: `Operation ${key} moved from channel ${op.channel} to ${n.channel}.`,
        before: op.channel,
        after: n.channel,
        ...s(op, n),
      });
    }
    if ((op.bindings ?? '') !== (n.bindings ?? '')) {
      emitter.emit('ASYNC_BINDINGS_CHANGED', {
        logicalPath: `${lp} › bindings`,
        entityKey: op.channel,
        message: `Operation bindings for ${key} changed.`,
        tags: ['coverage-gap'],
        ...s(op, n),
      });
    }
    // App sends → consumers receive (response polarity); app receives → producers send (request polarity).
    const pol = op.action === 'send' ? 'response' : 'request';
    for (const [mk, m] of Object.entries(op.messages)) {
      const nm = n.messages[mk];
      const mlp = `${lp} › message ${mk}`;
      if (!nm) {
        emitter.emit('ASYNC_MESSAGE_REMOVED', {
          logicalPath: mlp,
          entityKey: op.channel,
          message: `Message ${mk} is no longer exchanged by ${key}.`,
          before: mk,
          ...s(m),
        });
        continue;
      }
      if ((m.contentType ?? '') !== (nm.contentType ?? '')) {
        emitter.emit('ASYNC_CONTENT_TYPE_CHANGED', {
          logicalPath: mlp,
          entityKey: op.channel,
          message: `Content type of ${mk} changed from ${m.contentType ?? '(default)'} to ${nm.contentType ?? '(default)'}.`,
          before: m.contentType,
          after: nm.contentType,
          ...s(m, nm),
        });
      }
      if ((m.bindings ?? '') !== (nm.bindings ?? '')) {
        emitter.emit('ASYNC_BINDINGS_CHANGED', {
          logicalPath: `${mlp} › bindings`,
          entityKey: op.channel,
          message: `Message bindings for ${mk} changed.`,
          tags: ['coverage-gap'],
          ...s(m, nm),
        });
      }
      cmp.emitComparison(emitter, m.payload, nm.payload, pol, {
        logicalPath: `${mlp} › payload`,
        entityKey: op.channel,
      });
      cmp.emitComparison(emitter, m.headers, nm.headers, pol, {
        logicalPath: `${mlp} › headers`,
        entityKey: op.channel,
      });
    }
    for (const [mk, nm] of Object.entries(n.messages)) {
      if (!op.messages[mk])
        emitter.emit('ASYNC_MESSAGE_ADDED', {
          logicalPath: `${lp} › message ${mk}`,
          entityKey: op.channel,
          message: `Operation ${key} can now ${op.action} message ${mk}.`,
          after: mk,
          ...s(undefined, nm),
        });
    }
  }
  for (const [key, n] of Object.entries(b.operations)) {
    if (!a.operations[key])
      emitter.emit('ASYNC_OPERATION_ADDED', {
        logicalPath: `operation ${key}`,
        entityKey: n.channel,
        message: `Operation ${key} (${n.action} on ${n.channel}) was added.`,
        after: `${n.action} ${n.channel}`,
        ...s(undefined, n),
      });
  }
}
