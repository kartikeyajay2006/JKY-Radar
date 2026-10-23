import type { EvidenceLevel, Finding, FindingSeverity, Protocol, SourceRef } from '../domain/types.js';
import { SEVERITY_RANK } from '../domain/types.js';
import { canonicalJson } from '../util/canonical.js';
import { sha256Hex } from '../util/sha256.js';
import { ruleRegistry } from './registry.js';

export interface EmitInput {
  logicalPath: string;
  /** Specific sentence describing what changed. */
  message: string;
  entityKey?: string;
  before?: unknown;
  after?: unknown;
  baselineSource?: SourceRef;
  candidateSource?: SourceRef;
  tags?: string[];
  unknowns?: string;
}

export interface EmitterOptions {
  protocol: Protocol;
  /** Maximum severity allowed for this comparison (e.g. heuristic inputs cap at potentially_breaking). */
  severityCap?: FindingSeverity;
  /** Overrides the rule evidence level (e.g. heuristic projections). */
  evidence?: EvidenceLevel;
  includeInformational?: boolean;
  /** Extra tags added to every finding. */
  tags?: string[];
  /** Hard cap on findings to bound memory. */
  maxFindings?: number;
}

export class FindingEmitter {
  private readonly items = new Map<string, Finding>();
  truncated = false;

  constructor(private readonly opts: EmitterOptions) {}

  emit(ruleId: string, input: EmitInput): void {
    const rule = ruleRegistry.get(ruleId);
    if (rule.severity === 'informational' && this.opts.includeInformational === false) return;
    if (this.items.size >= (this.opts.maxFindings ?? 5000)) {
      this.truncated = true;
      return;
    }
    let severity = rule.severity;
    const tags = new Set([...(this.opts.tags ?? []), ...(input.tags ?? []), rule.category]);
    let explanation = input.message;
    const cap = this.opts.severityCap;
    if (cap && SEVERITY_RANK[severity] < SEVERITY_RANK[cap]) {
      tags.add('severity-capped');
      explanation += ` (Rule severity "${rule.severity}" capped to "${cap}" because the input is not an authoritative contract.)`;
      severity = cap;
    }
    const evidence: EvidenceLevel = this.opts.evidence ?? rule.evidence;
    const fingerprint = sha256Hex(
      canonicalJson([ruleId, input.logicalPath, input.before ?? null, input.after ?? null]),
    ).slice(0, 20);
    if (this.items.has(fingerprint)) return;
    const finding: Finding = {
      ruleId,
      severity,
      protocol: this.opts.protocol,
      title: rule.title,
      explanation,
      impact: rule.impact,
      recommendation: rule.recommendation,
      logicalPath: input.logicalPath,
      evidenceLevel: evidence,
      fingerprint,
      tags: [...tags].sort(),
    };
    const unknowns = input.unknowns ?? rule.unknowns;
    if (unknowns) finding.unknowns = unknowns;
    if (input.entityKey) finding.entityKey = input.entityKey;
    if (input.before !== undefined) finding.before = input.before;
    if (input.after !== undefined) finding.after = input.after;
    if (input.baselineSource) finding.baselineSource = { file: 'baseline', ...input.baselineSource };
    if (input.candidateSource) finding.candidateSource = { file: 'candidate', ...input.candidateSource };
    this.items.set(fingerprint, finding);
  }

  findings(): Finding[] {
    return sortFindings([...this.items.values()]);
  }
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.logicalPath.localeCompare(b.logicalPath) ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.fingerprint.localeCompare(b.fingerprint),
  );
}
