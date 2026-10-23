import type { CoverageReport, Finding, FindingSeverity, GateDecision, GateResult } from '../domain/types.js';
import { SEVERITIES } from '../domain/types.js';
import { canonicalJson } from '../util/canonical.js';
import { sha256Hex } from '../util/sha256.js';

export type SeverityAction = 'block' | 'warn' | 'ignore';

export interface RuleOverride {
  ruleId: string;
  severity: FindingSeverity;
  justification: string;
}

export interface ReleasePolicy {
  id: string;
  name: string;
  revision: number;
  /** What the gate does when at least one finding of a severity is present. */
  actions: Record<FindingSeverity, SeverityAction>;
  /** Gate outcome when coverage gaps (needs_review findings tagged "coverage-gap", or coverage level "unknown") exist and nothing blocks. */
  onCoverageGap: 'inconclusive' | 'warn';
  /** Gate outcome when coverage is "partial" and nothing else warns. */
  onPartialCoverage: 'warn' | 'pass';
  ruleOverrides: RuleOverride[];
  requireReview: boolean;
  forbidSelfApproval: boolean;
  minApprovals: number;
  protectedEnvironments: string[];
}

export const DEFAULT_POLICY: ReleasePolicy = {
  id: 'jky-default',
  name: 'JKY-Radar default',
  revision: 1,
  actions: {
    breaking: 'block',
    potentially_breaking: 'warn',
    needs_review: 'warn',
    non_breaking: 'ignore',
    informational: 'ignore',
  },
  onCoverageGap: 'inconclusive',
  onPartialCoverage: 'warn',
  ruleOverrides: [],
  requireReview: true,
  forbidSelfApproval: true,
  minApprovals: 1,
  protectedEnvironments: ['production'],
};

export function policyVersion(policy: ReleasePolicy): string {
  const material = canonicalJson({
    actions: policy.actions,
    onCoverageGap: policy.onCoverageGap,
    onPartialCoverage: policy.onPartialCoverage,
    ruleOverrides: policy.ruleOverrides,
  });
  return `${policy.id}@r${policy.revision}#${sha256Hex(material).slice(0, 8)}`;
}

export function emptyCounts(): Record<FindingSeverity, number> {
  return Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<FindingSeverity, number>;
}

/**
 * Evaluate the release gate. Overrides change the gate's effective severity only;
 * findings themselves are never rewritten.
 */
export function evaluateGate(
  findings: Finding[],
  coverage: CoverageReport,
  policy: ReleasePolicy,
): GateResult {
  const counts = emptyCounts();
  const effectiveCounts = emptyCounts();
  const overridden: GateResult['overridden'] = [];
  const overrides = new Map(policy.ruleOverrides.map((o) => [o.ruleId, o]));
  let coverageGap = coverage.level === 'unknown';

  for (const f of findings) {
    counts[f.severity]++;
    const o = overrides.get(f.ruleId);
    const eff = o ? o.severity : f.severity;
    if (o && o.severity !== f.severity) {
      overridden.push({
        fingerprint: f.fingerprint,
        ruleId: f.ruleId,
        from: f.severity,
        to: o.severity,
        justification: o.justification,
      });
    }
    effectiveCounts[eff]++;
    if (eff === 'needs_review' && f.tags.includes('coverage-gap')) coverageGap = true;
  }

  const reasons: string[] = [];
  const has = (action: SeverityAction) =>
    SEVERITIES.filter((s) => policy.actions[s] === action && effectiveCounts[s] > 0);

  let decision: GateDecision;
  const blockers = has('block');
  const warners = has('warn');
  if (blockers.length > 0) {
    decision = 'block';
    for (const s of blockers)
      reasons.push(`${effectiveCounts[s]} ${s.replace('_', ' ')} finding(s) — policy action "block".`);
  } else if (coverageGap && policy.onCoverageGap === 'inconclusive') {
    decision = 'inconclusive';
    reasons.push(
      coverage.level === 'unknown'
        ? 'Coverage is unknown: the inputs could not be compared reliably.'
        : 'Changes were found in constructs JKY-Radar cannot evaluate formally (coverage gap).',
    );
  } else if (warners.length > 0 || coverageGap) {
    decision = 'warn';
    for (const s of warners)
      reasons.push(`${effectiveCounts[s]} ${s.replace('_', ' ')} finding(s) — policy action "warn".`);
    if (coverageGap) reasons.push('Coverage gap present (policy downgrades it to warn).');
  } else if (coverage.level === 'partial' && policy.onPartialCoverage === 'warn') {
    decision = 'warn';
    reasons.push(
      'No blocking findings, but coverage is partial — absence of findings is not proof of safety.',
    );
  } else {
    decision = 'pass';
    reasons.push(
      coverage.level === 'full'
        ? 'No findings require action and all compared constructs are covered by tested rules.'
        : 'No findings require action (policy accepts partial coverage).',
    );
  }
  if (overridden.length > 0)
    reasons.push(`${overridden.length} finding(s) re-classified by explicit policy overrides.`);

  return {
    decision,
    policyId: policy.id,
    policyVersion: policyVersion(policy),
    reasons,
    counts,
    overridden,
  };
}
