/** @import { CoverageReport, Finding, FindingSeverity, GateDecision, GateResult } from '../domain/types.js' */

import { SEVERITIES } from '../domain/types.js';
import { canonicalJson } from '../util/canonical.js';
import { sha256Hex } from '../util/sha256.js';

/** @typedef {'block' | 'warn' | 'ignore'} SeverityAction */

/**
 * @typedef {Object} RuleOverride
 * @property {string} ruleId
 * @property {FindingSeverity} severity
 * @property {string} justification
 */

/**
 * @typedef {Object} ReleasePolicy
 * @property {string} id
 * @property {string} name
 * @property {number} revision
 * @property {Record<FindingSeverity, SeverityAction>} actions - What the gate does when at least one finding of a severity is present.
 * @property {'inconclusive' | 'warn'} onCoverageGap - Gate outcome when coverage gaps (needs_review findings tagged "coverage-gap", or coverage level "unknown") exist and nothing blocks.
 * @property {'warn' | 'pass'} onPartialCoverage - Gate outcome when coverage is "partial" and nothing else warns.
 * @property {RuleOverride[]} ruleOverrides
 * @property {boolean} requireReview
 * @property {boolean} forbidSelfApproval
 * @property {number} minApprovals
 * @property {string[]} protectedEnvironments
 */

/** @type {ReleasePolicy} */
export const DEFAULT_POLICY = {
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

/**
 * @param {ReleasePolicy} policy
 * @returns {string}
 */
export function policyVersion(policy) {
  const material = canonicalJson({
    actions: policy.actions,
    onCoverageGap: policy.onCoverageGap,
    onPartialCoverage: policy.onPartialCoverage,
    ruleOverrides: policy.ruleOverrides,
  });
  return `${policy.id}@r${policy.revision}#${sha256Hex(material).slice(0, 8)}`;
}

/** @returns {Record<FindingSeverity, number>} */
export function emptyCounts() {
  return /** @type {Record<FindingSeverity, number>} */ (Object.fromEntries(SEVERITIES.map((s) => [s, 0])));
}

/**
 * Evaluate the release gate. Overrides change the gate's effective severity only;
 * findings themselves are never rewritten.
 * @param {Finding[]} findings
 * @param {CoverageReport} coverage
 * @param {ReleasePolicy} policy
 * @returns {GateResult}
 */
export function evaluateGate(findings, coverage, policy) {
  const counts = emptyCounts();
  const effectiveCounts = emptyCounts();
  /** @type {GateResult['overridden']} */
  const overridden = [];
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

  /** @type {string[]} */
  const reasons = [];
  /** @param {SeverityAction} action */
  const has = (action) => SEVERITIES.filter((s) => policy.actions[s] === action && effectiveCounts[s] > 0);

  /** @type {GateDecision} */
  let decision;
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
