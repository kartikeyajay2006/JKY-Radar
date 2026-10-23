/** @import { CoverageLevel, CoverageReport, Finding, Protocol } from '../domain/types.js' */

import { ruleRegistry } from '../rules/registry.js';

/**
 * @typedef {Object} CoverageInput
 * @property {Protocol} protocol
 * @property {string[]} ignoredConstructs
 * @property {Finding[]} findings
 * @property {'supported' | 'partial' | 'experimental' | 'unsupported'} adapterStatus - Adapter-level support: partial/experimental adapters never yield "full".
 * @property {string[]} [reasons] - Extra reasons from the comparison (e.g. heuristic input, cross-format projection).
 * @property {boolean} [unknown] - Forces "unknown" (nothing could be compared).
 * @property {boolean} [truncated]
 * @property {string} [statusLabel] - Label used in the status reason, e.g. "The grpc adapter" or "Cross-format comparison".
 */

/**
 * @param {CoverageInput} input
 * @returns {CoverageReport}
 */
export function computeCoverage(input) {
  const rules = ruleRegistry.forProtocol(input.protocol);
  const reasons = [...(input.reasons ?? [])];
  const ignored = [...new Set(input.ignoredConstructs)].sort();
  if (ignored.length > 0) reasons.push(`${ignored.length} construct type(s) present but not semantically compared.`);
  if (input.adapterStatus !== 'supported') {
    reasons.push(`${input.statusLabel ?? `The ${input.protocol} adapter`} is ${input.adapterStatus}.`);
  }
  const gaps = input.findings.filter((f) => f.tags.includes('coverage-gap')).length;
  if (gaps > 0) reasons.push(`${gaps} change(s) in constructs that are not formally evaluated.`);
  if (input.truncated) reasons.push('Finding limit reached; output truncated.');

  /** @type {CoverageLevel} */
  let level = 'full';
  if (input.unknown) level = 'unknown';
  else if (reasons.length > 0) level = 'partial';

  return {
    level,
    supportedRules: rules.length,
    testedRules: rules.filter((r) => r.tested).length,
    ignoredConstructs: ignored,
    reasons,
  };
}
