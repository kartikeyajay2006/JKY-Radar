import { HTTP_RULES } from './http.js';
import { SCHEMA_RULES } from './schema.js';
import { GRAPHQL_RULES } from './graphql.js';
import { ASYNCAPI_RULES, POSTMAN_RULES, PROTOBUF_RULES } from './other.js';

/** @import { Protocol } from '../domain/types.js' */
/** @import { RuleDefinition } from './definition.js' */

/** Bump when rule semantics change. Stored with every analysis for reproducibility. */
export const RULE_REGISTRY_VERSION = '1.0.0';

/** @type {RuleDefinition[]} */
const ALL = [
  ...HTTP_RULES,
  ...SCHEMA_RULES,
  ...GRAPHQL_RULES,
  ...POSTMAN_RULES,
  ...PROTOBUF_RULES,
  ...ASYNCAPI_RULES,
];

const BY_ID = /** @type {Map<string, RuleDefinition>} */ (new Map());
for (const rule of ALL) {
  if (BY_ID.has(rule.id)) throw new Error(`Duplicate rule id ${rule.id}`);
  if (!/^[A-Z][A-Z0-9_]+$/.test(rule.id)) throw new Error(`Invalid rule id ${rule.id}`);
  BY_ID.set(rule.id, Object.freeze({ ...rule }));
}

export const ruleRegistry = {
  version: RULE_REGISTRY_VERSION,
  /** @returns {readonly RuleDefinition[]} */
  all() {
    return [...BY_ID.values()];
  },
  /**
   * @param {string} id
   * @returns {RuleDefinition}
   */
  get(id) {
    const r = BY_ID.get(id);
    if (!r) throw new Error(`Unknown rule id ${id}`);
    return r;
  },
  /**
   * @param {string} id
   * @returns {boolean}
   */
  has(id) {
    return BY_ID.has(id);
  },
  /**
   * @param {Protocol} protocol
   * @returns {RuleDefinition[]}
   */
  forProtocol(protocol) {
    return [...BY_ID.values()].filter((r) => r.protocols.includes(protocol));
  },
};
