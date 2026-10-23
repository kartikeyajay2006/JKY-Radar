import type { Diagnostic, ParsedContract, SourceRef, SupportStatus } from '@jky/radar-core';
import {
  createNormalizeContext,
  getAtPointer,
  isObject,
  type NormalizeContext,
  type SchemaDialect,
} from '@jky/radar-core';
import type { StructuredDocument } from './parse/structured.js';
import { nearestLocator } from './parse/structured.js';

export const ADAPTER_VERSION = '1.0.0';

export class ContractValidationError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    super(diagnostics.map((d) => d.message).join('; '));
    this.name = 'ContractValidationError';
  }
}

export interface AdapterContext {
  root: unknown;
  locate: (pointer: string) => SourceRef | undefined;
  diagnostics: Diagnostic[];
  ignored: Set<string>;
  schemaCtx: NormalizeContext;
}

export function createAdapterContext(doc: StructuredDocument, dialect: SchemaDialect): AdapterContext {
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

export function error(ctx: AdapterContext, code: string, message: string, pointer?: string): Diagnostic {
  const d: Diagnostic = { severity: 'error', code, message };
  const src = pointer !== undefined ? ctx.locate(pointer) : undefined;
  if (src) d.source = src;
  ctx.diagnostics.push(d);
  return d;
}

export function warn(
  ctx: AdapterContext,
  code: string,
  message: string,
  pointer?: string,
  severity: 'warning' | 'info' = 'warning',
) {
  const d: Diagnostic = { severity, code, message };
  const src = pointer !== undefined ? ctx.locate(pointer) : undefined;
  if (src) d.source = src;
  ctx.diagnostics.push(d);
}

/**
 * Resolve a (possibly chained) local "$ref" for non-schema objects such as parameters or responses.
 * Remote references are never fetched.
 */
export function resolveObject(
  ctx: AdapterContext,
  value: unknown,
  pointer: string,
): { value: Record<string, unknown>; pointer: string } | undefined {
  let cur = value;
  let ptr = pointer;
  const seen = new Set<string>();
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
    let target: unknown;
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

export function finishContract<M>(
  ctx: AdapterContext,
  base: Omit<ParsedContract<M>, 'diagnostics' | 'ignoredConstructs'>,
): ParsedContract<M> {
  const errors = ctx.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0) throw new ContractValidationError(ctx.diagnostics);
  return { ...base, diagnostics: ctx.diagnostics, ignoredConstructs: [...ctx.ignored].sort() };
}

export interface AdapterInfo {
  status: SupportStatus;
}
