import type { ParsedContract } from '../domain/models.js';
import type {
  AnalysisOptions,
  AnalysisResult,
  ComparisonMode,
  ContractSummary,
  Diagnostic,
  Protocol,
  SupportStatus,
} from '../domain/types.js';
import { computeCoverage } from '../coverage/coverage.js';
import { DEFAULT_POLICY, evaluateGate, policyVersion, type ReleasePolicy } from '../gate/policy.js';
import type { FindingEmitter } from '../rules/emitter.js';
import { RULE_REGISTRY_VERSION } from '../rules/registry.js';

/** Bump on any change that can alter analysis output. */
export const ENGINE_VERSION = '1.0.0';

export function summarize(c: ParsedContract): ContractSummary {
  const s: ContractSummary = { protocol: c.protocol, formatVersion: c.formatVersion, stats: c.stats };
  if (c.title) s.title = c.title;
  if (c.version) s.version = c.version;
  return s;
}

export interface FinalizeInput {
  protocol: Protocol;
  comparisonMode: ComparisonMode;
  baseline: ParsedContract;
  candidate: ParsedContract;
  emitter: FindingEmitter;
  adapterStatus: SupportStatus;
  adapterVersion: string;
  policy?: ReleasePolicy;
  options: AnalysisOptions;
  extraIgnored?: string[];
  coverageReasons?: string[];
  coverageUnknown?: boolean;
  statusLabel?: string;
}

export function finalizeAnalysis(input: FinalizeInput): AnalysisResult {
  const policy = input.policy ?? DEFAULT_POLICY;
  const findings = input.emitter.findings();
  const tag = (file: 'baseline' | 'candidate', d: Diagnostic): Diagnostic => ({
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
