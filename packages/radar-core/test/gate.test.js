/** @import { CoverageReport, Finding, ReleasePolicy } from '../src/index.js' */
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, evaluateGate, policyVersion } from '../src/index.js';

/**
 * @param {Finding['severity']} severity
 * @param {string[]} [tags]
 * @returns {Finding}
 */
const f = (severity, ruleId = 'X', tags = []) => ({
  ruleId,
  severity,
  protocol: 'openapi',
  title: 't',
  explanation: 'e',
  impact: 'i',
  recommendation: 'r',
  logicalPath: `p-${ruleId}-${severity}`,
  evidenceLevel: 'contract_proven',
  fingerprint: `${ruleId}${severity}`,
  tags,
});
/**
 * @param {CoverageReport['level']} level
 * @returns {CoverageReport}
 */
const cov = (level) => ({
  level,
  supportedRules: 1,
  testedRules: 1,
  ignoredConstructs: [],
  reasons: [],
});

describe('release gate', () => {
  it('blocks on any confirmed breaking change', () => {
    expect(evaluateGate([f('breaking'), f('non_breaking')], cov('full'), DEFAULT_POLICY).decision).toBe(
      'block',
    );
  });
  it('warns on potentially breaking findings', () => {
    expect(evaluateGate([f('potentially_breaking')], cov('full'), DEFAULT_POLICY).decision).toBe('warn');
  });
  it('is inconclusive when a coverage gap exists and nothing blocks', () => {
    expect(
      evaluateGate(
        [f('needs_review', 'SCHEMA_COMBINATOR_CHANGED', ['coverage-gap'])],
        cov('partial'),
        DEFAULT_POLICY,
      ).decision,
    ).toBe('inconclusive');
  });
  it('blocking beats inconclusive', () => {
    expect(
      evaluateGate([f('breaking'), f('needs_review', 'G', ['coverage-gap'])], cov('partial'), DEFAULT_POLICY)
        .decision,
    ).toBe('block');
  });
  it('no findings is NOT a pass when coverage is partial', () => {
    const g = evaluateGate([], cov('partial'), DEFAULT_POLICY);
    expect(g.decision).toBe('warn');
    expect(g.reasons.join(' ')).toMatch(/not proof of safety/);
  });
  it('unknown coverage is inconclusive', () => {
    expect(evaluateGate([], cov('unknown'), DEFAULT_POLICY).decision).toBe('inconclusive');
  });
  it('passes only with no actionable findings and full coverage', () => {
    expect(evaluateGate([f('non_breaking'), f('informational')], cov('full'), DEFAULT_POLICY).decision).toBe(
      'pass',
    );
  });
  it('overrides change the gate but never rewrite findings', () => {
    const findings = [f('breaking', 'HTTP_OPERATION_REMOVED')];
    /** @type {ReleasePolicy} */
    const policy = {
      ...DEFAULT_POLICY,
      revision: 2,
      ruleOverrides: [
        {
          ruleId: 'HTTP_OPERATION_REMOVED',
          severity: 'potentially_breaking',
          justification: 'Endpoint unused for 90 days',
        },
      ],
    };
    const g = evaluateGate(findings, cov('full'), policy);
    expect(g.decision).toBe('warn');
    expect(g.overridden).toHaveLength(1);
    expect(findings[0].severity).toBe('breaking');
    expect(g.counts.breaking).toBe(1);
  });
  it('policy version changes with semantics', () => {
    expect(policyVersion(DEFAULT_POLICY)).not.toBe(
      policyVersion({ ...DEFAULT_POLICY, onPartialCoverage: 'pass' }),
    );
    expect(policyVersion(DEFAULT_POLICY)).toBe(policyVersion({ ...DEFAULT_POLICY }));
  });
});
