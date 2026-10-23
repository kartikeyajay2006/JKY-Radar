import { isObject, normalizeSchema } from '@jky/radar-core';

import { createAdapterContext, error, finishContract, warn } from '../common.js';

/** @import { JsonSchemaContractModel, ParsedContract } from '@jky/radar-core' */
/** @import { SchemaDialect } from '@jky/radar-core' */
/** @import { StructuredDocument } from '../parse/structured.js' */

/**
 * @param {string | undefined} uri
 * @returns {{ dialect: SchemaDialect; label: string }}
 */
export function dialectFromSchemaUri(uri) {
  if (!uri) return { dialect: 'draft2020', label: 'unspecified (2020-12 assumed)' };
  if (/draft-04/.test(uri)) return { dialect: 'draft4', label: 'draft-04' };
  if (/draft-06/.test(uri)) return { dialect: 'draft6', label: 'draft-06' };
  if (/draft-07/.test(uri)) return { dialect: 'draft7', label: 'draft-07' };
  if (/2019-09/.test(uri)) return { dialect: 'draft2019', label: '2019-09' };
  if (/2020-12/.test(uri)) return { dialect: 'draft2020', label: '2020-12' };
  return { dialect: 'draft2020', label: `unknown (${uri})` };
}

/**
 * @param {StructuredDocument} doc
 * @returns {ParsedContract<JsonSchemaContractModel>}
 */
export function parseJsonSchema(doc) {
  const root = doc.value;
  const uri = isObject(root) && typeof root.$schema === 'string' ? root.$schema : undefined;
  const { dialect, label } = dialectFromSchemaUri(uri);
  const ctx = createAdapterContext(doc, dialect);
  if (!isObject(root) && typeof root !== 'boolean') {
    error(ctx, 'INVALID_SCHEMA', 'A JSON Schema document must be an object or boolean.', '');
  }
  if (!uri) warn(ctx, 'NO_SCHEMA_DIALECT', 'No $schema declared; 2020-12 semantics assumed.', '', 'info');
  else if (label.startsWith('unknown'))
    warn(ctx, 'UNKNOWN_DIALECT', `Unrecognised $schema ${uri}; 2020-12 semantics assumed.`, '/$schema');
  const rootSchema = normalizeSchema(root, '', ctx.schemaCtx);
  const title = isObject(root) && typeof root.title === 'string' ? root.title : undefined;
  const defs = isObject(root)
    ? { ...(isObject(root.$defs) ? root.$defs : {}), ...(isObject(root.definitions) ? root.definitions : {}) }
    : {};
  return finishContract(ctx, {
    protocol: 'json-schema',
    formatVersion: label,
    title,
    model: { kind: 'json-schema', dialect: label, root: rootSchema, title },
    stats: {
      definitions: Object.keys(defs).length,
      properties: Object.keys(rootSchema.properties).length,
      schemaNodes: ctx.schemaCtx.nodeCount,
    },
  });
}
