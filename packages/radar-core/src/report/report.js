import { PROTOCOL_LABEL, SEVERITIES, SEVERITY_LABEL } from '../domain/types.js';

import { preview } from '../util/canonical.js';

/** @import { AnalysisResult, Finding, FindingSeverity } from '../domain/types.js' */
/** @import { ImpactReport } from '../impact/impact.js' */

export const REPORT_SCHEMA_VERSION = '1.0';

/**
 * @typedef {Object} ReportVersionRef
 * @property {string} id
 * @property {string} label
 * @property {string} rawHash
 * @property {string} [fileName]
 */

/**
 * @typedef {Object} ReportReview
 * @property {string} reviewer
 * @property {string} decision
 * @property {string} rationale
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ReportContext
 * @property {string} analysisId
 * @property {string} projectName
 * @property {string} [workspaceName]
 * @property {string} createdAt
 * @property {string} exportedAt
 * @property {ReportVersionRef} baseline
 * @property {ReportVersionRef} candidate
 * @property {AnalysisResult} result
 * @property {ImpactReport} [impact]
 * @property {ReportReview[]} [reviews]
 * @property {string} [policyName]
 */

export const GATE_LABEL = /** @type {const} */ ({
  pass: 'PASS',
  warn: 'WARN',
  block: 'BLOCK',
  inconclusive: 'INCONCLUSIVE',
});

/** @param {ReportContext} ctx */
export function buildJsonReport(ctx) {
  return {
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    generator: {
      name: 'JKY-Radar',
      engineVersion: ctx.result.engineVersion,
      ruleRegistryVersion: ctx.result.ruleRegistryVersion,
      adapterVersion: ctx.result.adapterVersion,
    },
    exportedAt: ctx.exportedAt,
    analysis: {
      id: ctx.analysisId,
      project: ctx.projectName,
      workspace: ctx.workspaceName,
      createdAt: ctx.createdAt,
      protocol: ctx.result.protocol,
      comparisonMode: ctx.result.comparisonMode,
      policy: { name: ctx.policyName, version: ctx.result.policyVersion },
      options: ctx.result.options,
    },
    inputs: {
      baseline: { ...ctx.baseline, summary: ctx.result.baseline },
      candidate: { ...ctx.candidate, summary: ctx.result.candidate },
    },
    gate: ctx.result.gate,
    coverage: ctx.result.coverage,
    findings: ctx.result.findings,
    diagnostics: {
      parserWarnings: ctx.result.parserWarnings,
      uncoveredConstructs: ctx.result.uncoveredConstructs,
    },
    impact: ctx.impact ?? null,
    reviews: ctx.reviews ?? [],
    limitations: LIMITATIONS,
  };
}

export const LIMITATIONS = [
  'JKY-Radar compares contract documents. It does not observe live traffic or undocumented behaviour.',
  'Remote $ref references are never fetched; their content is reported as unresolved.',
  'oneOf/anyOf/not/conditional composition and regular-expression patterns are flagged for review rather than decided formally.',
  'Consumer impact covers registered consumers only; unregistered clients may also be affected.',
  'An empty findings list is not proof of compatibility when coverage is partial or unknown.',
];

/** @param {string} s */
const mdEscape = (s) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * @param {Finding[]} findings
 * @returns {Map<string, Finding[]>}
 */
function groupByEntity(findings) {
  const m = /** @type {Map<string, Finding[]>} */ (new Map());
  for (const f of findings) {
    const k = f.entityKey ?? '(contract-wide)';
    const list = m.get(k) ?? [];
    list.push(f);
    m.set(k, list);
  }
  return m;
}

/**
 * @param {ReportContext} ctx
 * @returns {string}
 */
export function buildMarkdownReport(ctx) {
  const r = ctx.result;
  /** @type {string[]} */
  const L = [];
  const counts = r.gate.counts;
  L.push(`# JKY-Radar compatibility report — ${ctx.projectName}`);
  L.push('');
  L.push(
    `> **Release gate: ${GATE_LABEL[r.gate.decision]}** · coverage **${r.coverage.level}** · ${PROTOCOL_LABEL[r.protocol]} · policy \`${r.policyVersion}\``,
  );
  L.push('');
  L.push('## Executive summary');
  L.push('');
  for (const reason of r.gate.reasons) L.push(`- ${reason}`);
  L.push('');
  L.push('| Severity | Count |');
  L.push('| --- | ---: |');
  for (const s of SEVERITIES) L.push(`| ${SEVERITY_LABEL[s]} | ${counts[s]} |`);
  L.push('');
  L.push('## Scope and fingerprints');
  L.push('');
  L.push('| | Baseline | Candidate |');
  L.push('| --- | --- | --- |');
  L.push(`| Label | ${mdEscape(ctx.baseline.label)} | ${mdEscape(ctx.candidate.label)} |`);
  L.push(
    `| Format | ${r.baseline.protocol} ${r.baseline.formatVersion} | ${r.candidate.protocol} ${r.candidate.formatVersion} |`,
  );
  L.push(`| SHA-256 | \`${ctx.baseline.rawHash}\` | \`${ctx.candidate.rawHash}\` |`);
  if (ctx.baseline.fileName || ctx.candidate.fileName) {
    L.push(
      `| File | ${mdEscape(ctx.baseline.fileName ?? '—')} | ${mdEscape(ctx.candidate.fileName ?? '—')} |`,
    );
  }
  L.push('');
  L.push(
    `Analysis \`${ctx.analysisId}\` · created ${ctx.createdAt} · exported ${ctx.exportedAt} · engine ${r.engineVersion} · rules ${r.ruleRegistryVersion} · adapter ${r.adapterVersion} · mode ${r.comparisonMode}`,
  );
  L.push('');

  /**
   * @param {string} title
   * @param {FindingSeverity[]} sev
   */
  const section = (title, sev) => {
    const list = r.findings.filter((f) => sev.includes(f.severity));
    if (list.length === 0) return;
    L.push(`## ${title} (${list.length})`);
    L.push('');
    for (const [entity, fs] of groupByEntity(list)) {
      L.push(`### ${mdEscape(entity)}`);
      L.push('');
      for (const f of fs) {
        L.push(`- **${SEVERITY_LABEL[f.severity]} · \`${f.ruleId}\` — ${f.title}**  `);
        L.push(`  ${f.explanation}  `);
        L.push(`  _Where:_ \`${f.logicalPath}\``);
        if (f.before !== undefined || f.after !== undefined) {
          L.push(
            `  _Before:_ \`${mdEscape(preview(f.before, 120))}\` → _After:_ \`${mdEscape(preview(f.after, 120))}\``,
          );
        }
        const srcs = [f.baselineSource, f.candidateSource]
          .filter(Boolean)
          .map((s) => `${s.file}${s.line ? `:${s.line}` : ''}${s.jsonPointer ? ` (${s.jsonPointer})` : ''}`);
        if (srcs.length) L.push(`  _Evidence (${f.evidenceLevel}):_ ${srcs.join(' · ')}`);
        L.push(`  _Why risky:_ ${f.impact}  `);
        L.push(`  _Fix:_ ${f.recommendation}`);
        if (f.unknowns) L.push(`  _Unknown:_ ${f.unknowns}`);
      }
      L.push('');
    }
  };
  section('Breaking changes', ['breaking']);
  section('Potentially breaking / needs review', ['potentially_breaking', 'needs_review']);
  section('Non-breaking changes', ['non_breaking']);
  section('Informational', ['informational']);
  if (r.findings.length === 0) {
    L.push('## Findings');
    L.push('');
    L.push(
      r.coverage.level === 'full'
        ? 'No differences were detected by the tested rules.'
        : 'No findings were produced, but coverage is not full — this is not proof of compatibility.',
    );
    L.push('');
  }

  if (ctx.impact) {
    L.push('## Consumer impact (registered consumers only)');
    L.push('');
    const impacted = ctx.impact.consumers.filter((c) => c.known.length || c.potential.length);
    if (impacted.length === 0) L.push('No registered consumer depends on a changed operation.');
    else {
      L.push('| Consumer | Criticality | Owner | Known | Potential | Worst |');
      L.push('| --- | --- | --- | ---: | ---: | --- |');
      for (const c of impacted) {
        L.push(
          `| ${mdEscape(c.name)} | ${c.criticality} | ${mdEscape(c.owner ?? '—')} | ${c.known.length} | ${c.potential.length} | ${c.worstSeverity ? SEVERITY_LABEL[c.worstSeverity] : '—'} |`,
        );
      }
    }
    L.push('');
    if (ctx.impact.unmatchedRiskyFindings.length) {
      L.push(
        `${ctx.impact.unmatchedRiskyFindings.length} risky finding(s) have no registered dependent. ${ctx.impact.disclaimer}`,
      );
    } else {
      L.push(ctx.impact.disclaimer);
    }
    L.push('');
  }

  L.push('## Review decisions');
  L.push('');
  if (!ctx.reviews || ctx.reviews.length === 0) L.push('No review decision recorded yet.');
  else
    for (const rv of ctx.reviews)
      L.push(`- ${rv.createdAt} — **${rv.decision}** by ${mdEscape(rv.reviewer)}: ${mdEscape(rv.rationale)}`);
  L.push('');

  L.push('## Coverage and diagnostics');
  L.push('');
  L.push(
    `Coverage level: **${r.coverage.level}** — ${r.coverage.testedRules}/${r.coverage.supportedRules} rules for this protocol have positive and negative tests.`,
  );
  for (const reason of r.coverage.reasons) L.push(`- ${reason}`);
  if (r.uncoveredConstructs.length) {
    L.push('');
    L.push('Constructs present but not semantically compared:');
    for (const c of r.uncoveredConstructs) L.push(`- ${c}`);
  }
  if (r.parserWarnings.length) {
    L.push('');
    L.push('Parser diagnostics:');
    for (const w of r.parserWarnings.slice(0, 100))
      L.push(`- ${w.severity.toUpperCase()} ${w.code}: ${mdEscape(w.message)}`);
  }
  L.push('');
  L.push('## Limitations');
  L.push('');
  for (const l of LIMITATIONS) L.push(`- ${l}`);
  L.push('');
  return L.join('\n');
}
