/** @import { EvidenceLevel, FindingSeverity, Protocol } from '../domain/types.js' */

/**
 * @typedef {Object} RuleDefinition
 * @property {string} id - Immutable identifier. Never rename or reuse.
 * @property {string} title
 * @property {FindingSeverity} severity
 * @property {readonly Protocol[]} protocols
 * @property {string} category
 * @property {string} description - When the rule fires.
 * @property {string} impact - Why it is risky for existing consumers.
 * @property {string} recommendation
 * @property {string} [unknowns] - What the contracts alone cannot prove.
 * @property {EvidenceLevel} evidence
 * @property {{ before: string; after: string }} [example]
 * @property {string} since - Registry version the rule was introduced in.
 * @property {boolean} tested - Whether a positive and a negative test case exist in the repository (enforced by packages/radar-adapters/test/rule-coverage.test.ts).
 */

/** @typedef {Omit<RuleDefinition, 'evidence' | 'since' | 'tested'> & Partial<Pick<RuleDefinition, 'evidence' | 'since' | 'tested'>>} RuleInput */

/**
 * @param {RuleInput[]} rules
 * @returns {RuleDefinition[]}
 */
export function defineRules(rules) {
  return rules.map((r) => ({ evidence: 'contract_proven', since: '1.0.0', tested: true, ...r }));
}

/** @type {readonly Protocol[]} */
export const HTTP_PROTOCOLS = ['openapi', 'swagger2', 'manual-rest'];
/** @type {readonly Protocol[]} */
export const SCHEMA_PROTOCOLS = ['openapi', 'swagger2', 'manual-rest', 'json-schema', 'asyncapi'];
