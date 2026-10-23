import { createNormalizeContext, getAtPointer, isObject } from '@jky/radar-core';

import { nearestLocator } from './parse/structured.js';

/** @import { Diagnostic, ParsedContract, SourceRef, SupportStatus } from '@jky/radar-core' */
/** @import { NormalizeContext, SchemaDialect } from '@jky/radar-core' */
/** @import { StructuredDocument } from './parse/structured.js' */

export const ADAPTER_VERSION = '1.0.1';

export class ContractValidationError extends Error {
  /** @param {Diagnostic[]} diagnostics */
  constructor(diagnostics) {
    super(diagnostics.map((d) => d.message).join('; '));
    /** @type {Diagnostic[]} */
    this.diagnostics = diagnostics;
    this.name = 'ContractValidationError';
  }
}

/**
 * @typedef {Object} AdapterContext
 * @property {unknown} root
 * @property {(pointer: string) => SourceRef | undefined} locate
 * @property {Diagnostic[]} diagnostics
 * @property {Set<string>} ignored
 * @property {NormalizeContext} schemaCtx
 */

/**
 * @param {StructuredDocument} doc
 * @param {SchemaDialect} dialect
 * @returns {AdapterContext}
 */
export function createAdapterContext(doc, dialect) {
  const locate = nearestLocator(doc.locate);
  const schemaCtx = createNormalizeContext(doc.value, dialect, locate);
  return {
    root: doc.value,
    locate,
    diagnostics: schemaCtx.diagnostics,
    ignored: schemaCtx.ignored,
    schemaCtx,
  };
}

/**
 * @param {AdapterContext} ctx
 * @param {string} code
 * @param {string} message
 * @param {string} [pointer]
 * @returns {Diagnostic}
 */
export function error(ctx, code, message, pointer) {
  /** @type {Diagnostic} */
  const d = { severity: 'error', code, message };
  const src = pointer !== undefined ? ctx.locate(pointer) : undefined;
  if (src) d.source = src;
  ctx.diagnostics.push(d);
  return d;
}

/**
 * @param {AdapterContext} ctx
 * @param {string} code
 * @param {string} message
 * @param {string} [pointer]
 * @param {'warning' | 'info'} [severity]
 */
export function warn(ctx, code, message, pointer, severity = 'warning') {
  /** @type {Diagnostic} */
  const d = { severity, code, message };
  const src = pointer !== undefined ? ctx.locate(pointer) : undefined;
  if (src) d.source = src;
  ctx.diagnostics.push(d);
}

/**
 * Resolve a (possibly chained) local "$ref" for non-schema objects such as parameters or responses.
 * Remote references are never fetched.
 * @param {AdapterContext} ctx
 * @param {unknown} value
 * @param {string} pointer
 * @returns {{ value: Record<string, unknown>; pointer: string } | undefined}
 */
export function resolveObject(ctx, value, pointer) {
  let cur = value;
  let ptr = pointer;
  const seen = /** @type {Set<string>} */ (new Set());
  for (let hops = 0; hops < 32; hops++) {
    if (!isObject(cur)) return undefined;
    const ref = cur.$ref;
    if (typeof ref !== 'string') return { value: cur, pointer: ptr };
    if (!ref.startsWith('#')) {
      warn(
        ctx,
        'REF_REMOTE_NOT_FETCHED',
        `Remote reference "${ref}" at ${ptr} was not fetched; the referenced object is ignored.`,
        ptr,
      );
      ctx.ignored.add('Remote $ref (never fetched)');
      return undefined;
    }
    if (seen.has(ref)) {
      error(ctx, 'REF_CYCLE', `Circular reference chain at ${ptr} (${ref}).`, ptr);
      return undefined;
    }
    seen.add(ref);
    /** @type {unknown} */
    let target;
    let decoded = ref.slice(1);
    try {
      decoded = decodeURIComponent(decoded);
      target = getAtPointer(ctx.root, decoded);
    } catch {
      target = undefined;
    }
    if (target === undefined) {
      error(ctx, 'REF_NOT_FOUND', `Reference ${ref} at ${ptr} does not resolve.`, ptr);
      return undefined;
    }
    cur = target;
    ptr = decoded;
  }
  error(ctx, 'REF_TOO_DEEP', `Reference chain too long at ${pointer}.`, pointer);
  return undefined;
}

/**
 * @template M
 * @param {AdapterContext} ctx
 * @param {Omit<ParsedContract<M>, 'diagnostics' | 'ignoredConstructs'>} base
 * @returns {ParsedContract<M>}
 */
export function finishContract(ctx, base) {
  const errors = ctx.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new ContractValidationError(ctx.diagnostics);
  return { ...base, diagnostics: ctx.diagnostics, ignoredConstructs: [...ctx.ignored].sort() };
}

/**
 * @typedef {Object} AdapterInfo
 * @property {SupportStatus} status
 */
