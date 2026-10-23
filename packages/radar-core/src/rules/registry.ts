import type { Protocol } from '../domain/types.js';
import type { RuleDefinition } from './definition.js';
import { HTTP_RULES } from './http.js';
import { SCHEMA_RULES } from './schema.js';
import { GRAPHQL_RULES } from './graphql.js';
import { ASYNCAPI_RULES, POSTMAN_RULES, PROTOBUF_RULES } from './other.js';

/** Bump when rule semantics change. Stored with every analysis for reproducibility. */
export const RULE_REGISTRY_VERSION = '1.0.0';

const ALL: RuleDefinition[] = [
  ...HTTP_RULES,
  ...SCHEMA_RULES,
  ...GRAPHQL_RULES,
  ...POSTMAN_RULES,
  ...PROTOBUF_RULES,
  ...ASYNCAPI_RULES,
];

const BY_ID = new Map<string, RuleDefinition>();
for (const rule of ALL) {
  if (BY_ID.has(rule.id)) throw new Error(`Duplicate rule id ${rule.id}`);
  if (!/^[A-Z][A-Z0-9_]+$/.test(rule.id)) throw new Error(`Invalid rule id ${rule.id}`);
  BY_ID.set(rule.id, Object.freeze({ ...rule }));
}

export const ruleRegistry = {
  version: RULE_REGISTRY_VERSION,
  all(): readonly RuleDefinition[] {
    return [...BY_ID.values()];
  },
  get(id: string): RuleDefinition {
    const r = BY_ID.get(id);
    if (!r) throw new Error(`Unknown rule id ${id}`);
    return r;
  },
  has(id: string): boolean {
    return BY_ID.has(id);
  },
  forProtocol(protocol: Protocol): RuleDefinition[] {
    return [...BY_ID.values()].filter((r) => r.protocols.includes(protocol));
  },
};
