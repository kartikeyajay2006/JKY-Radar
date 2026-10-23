import { computeCoverage } from '../coverage/coverage.js';
import { DEFAULT_POLICY, evaluateGate, policyVersion } from '../gate/policy.js';

import { RULE_REGISTRY_VERSION } from '../rules/registry.js';

/** @import { ParsedContract } from '../domain/models.js' */
/** @import { AnalysisOptions, AnalysisResult, ComparisonMode, ContractSummary, Diagnostic, Protocol, SupportStatus } from '../domain/types.js' */
/** @import { ReleasePolicy } from '../gate/policy.js' */
/** @import { FindingEmitter } from '../rules/emitter.js' */

/** Bump on any change that can alter analysis output. */
export const ENGINE_VERSION = '1.0.1';

/**
 * @param {ParsedContract} c
 * @returns {ContractSummary}
 */
export function summarize(c) {
  /** @type {ContractSummary} */
  const s = { protocol: c.protocol, formatVersion: c.formatVersion, stats: c.stats };
  if (c.title) s.title = c.title;
  if (c.version) s.version = c.version;
  return s;
}

/**
 * @typedef {Object} FinalizeInput
 * @property {Protocol} protocol
 * @property {ComparisonMode} comparisonMode
 * @property {ParsedContract} baseline
 * @property {ParsedContract} candidate
 * @property {FindingEmitter} emitter
 * @property {SupportStatus} adapterStatus
 * @property {string} adapterVersion
 * @property {ReleasePolicy} [policy]
 * @property {AnalysisOptions} options
 * @property {string[]} [extraIgnored]
 * @property {string[]} [coverageReasons]
 * @property {boolean} [coverageUnknown]
 * @property {string} [statusLabel]
 */

/**
 * @param {FinalizeInput} input
 * @returns {AnalysisResult}
 */
export function finalizeAnalysis(input) {
  const policy = input.policy ?? DEFAULT_POLICY;
  const findings = input.emitter.findings();
  /**
   * @param {'baseline' | 'candidate'} file
   * @param {Diagnostic} d
   * @returns {Diagnostic}
   */
  const tag = (file, d) => ({
    ...d,
    message: `[${file}] ${d.message}`,
    ...(d.source ? { source: { ...d.source, file } } : {}),
  });
  const parserWarnings = [
    ...input.baseline.diagnostics.map((d) => tag('baseline', d)),
    ...input.candidate.diagnostics.map((d) => tag('candidate', d)),
  ];
  const uncovered = [
    ...new Set([
      ...input.baseline.ignoredConstructs,
      ...input.candidate.ignoredConstructs,
      ...(input.extraIgnored ?? []),
    ]),
  ].sort();
  const coverage = computeCoverage({
    protocol: input.protocol,
    ignoredConstructs: uncovered,
    findings,
    adapterStatus: input.adapterStatus,
    reasons: input.coverageReasons ?? [],
    unknown: input.coverageUnknown ?? false,
    truncated: input.emitter.truncated,
    ...(input.statusLabel ? { statusLabel: input.statusLabel } : {}),
  });
  return {
    schemaVersion: '1.0',
    protocol: input.protocol,
    comparisonMode: input.comparisonMode,
    baseline: summarize(input.baseline),
    candidate: summarize(input.candidate),
    findings,
    uncoveredConstructs: uncovered,
    parserWarnings,
    coverage,
    gate: evaluateGate(findings, coverage, policy),
    engineVersion: ENGINE_VERSION,
    ruleRegistryVersion: RULE_REGISTRY_VERSION,
    adapterVersion: input.adapterVersion,
    policyVersion: policyVersion(policy),
    options: input.options,
  };
}
