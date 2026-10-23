import type { EvidenceLevel, FindingSeverity, Protocol } from '../domain/types.js';

export interface RuleDefinition {
  /** Immutable identifier. Never rename or reuse. */
  id: string;
  title: string;
  severity: FindingSeverity;
  protocols: readonly Protocol[];
  category: string;
  /** When the rule fires. */
  description: string;
  /** Why it is risky for existing consumers. */
  impact: string;
  recommendation: string;
  /** What the contracts alone cannot prove. */
  unknowns?: string;
  evidence: EvidenceLevel;
  example?: { before: string; after: string };
  /** Registry version the rule was introduced in. */
  since: string;
  /**
   * Whether a positive and a negative test case exist in the repository
   * (enforced by packages/radar-adapters/test/rule-coverage.test.ts).
   */
  tested: boolean;
}

export type RuleInput = Omit<RuleDefinition, 'evidence' | 'since' | 'tested'> &
  Partial<Pick<RuleDefinition, 'evidence' | 'since' | 'tested'>>;

export function defineRules(rules: RuleInput[]): RuleDefinition[] {
  return rules.map((r) => ({ evidence: 'contract_proven', since: '1.0.0', tested: true, ...r }));
}

export const HTTP_PROTOCOLS: readonly Protocol[] = ['openapi', 'swagger2', 'manual-rest'];
export const SCHEMA_PROTOCOLS: readonly Protocol[] = [
  'openapi',
  'swagger2',
  'manual-rest',
  'json-schema',
  'asyncapi',
];
