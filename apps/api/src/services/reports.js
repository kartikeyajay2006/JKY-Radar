import PDFDocument from 'pdfkit';

import {
  buildJsonReport,
  buildMarkdownReport,
  computeImpact,
  GATE_LABEL,
  LIMITATIONS,
  PROTOCOL_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  preview,
} from '@jky/radar-core';
import {
  Analysis,
  Consumer,
  ConsumerDependency,
  FindingModel,
  Project,
  Review,
  SpecVersion,
  User,
  Workspace,
} from '../models/index.js';
import { notFound } from '../lib/errors.js';
import { slugify } from '../lib/http.js';

/** @import { Types } from 'mongoose' */
/** @import { AnalysisResult, Finding, ImpactReport, ReportContext } from '@jky/radar-core' */

/**
 * @param {{ _id: Types.ObjectId; projectId: Types.ObjectId; }} analysis
 * @returns {Promise<ImpactReport>}
 */
export async function loadImpact(analysis) {
  const [findings, consumers, deps] = await Promise.all([
    FindingModel.find({ analysisId: analysis._id }).sort({ index: 1 }).lean(),
    Consumer.find({ projectId: analysis.projectId }).lean(),
    ConsumerDependency.find({ projectId: analysis.projectId }).lean(),
  ]);
  return computeImpact(
    /** @type {Finding[]} */ (findings),
    consumers.map((c) => ({
      id: c._id.toString(),
      name: c.name,
      owner: c.owner,
      team: c.team,
      criticality: /** @type {'low' | 'medium' | 'high' | 'critical'} */ (c.criticality),
      dependencies: deps
        .filter((d) => d.consumerId.equals(c._id))
        .map((d) => ({ operationKey: d.operationKey, id: d._id.toString() })),
    })),
  );
}

/**
 * @param {Types.ObjectId} analysisId
 * @returns {Promise<{ ctx: ReportContext; projectSlug: string }>}
 */
export async function buildReportContext(analysisId) {
  const a = await Analysis.findById(analysisId).lean();
  if (!a || a.state !== 'completed') throw notFound('Completed analysis');
  const [project, workspace, bv, cv, findings, reviews] = await Promise.all([
    Project.findById(a.projectId).lean(),
    Workspace.findById(a.workspaceId).lean(),
    SpecVersion.findById(a.baselineId).lean(),
    SpecVersion.findById(a.candidateId).lean(),
    FindingModel.find({ analysisId: a._id }).sort({ index: 1 }).lean(),
    Review.find({ analysisId: a._id }).sort({ createdAt: 1 }).lean(),
  ]);
  if (!project || !bv || !cv) throw notFound('Analysis inputs');
  const reviewers = await User.find({ _id: { $in: reviews.map((r) => r.reviewerId) } })
    .select('name')
    .lean();
  const names = new Map(reviewers.map((u) => [u._id.toString(), u.name]));
  const clean = findings.map((f) => {
    const {
      _id,
      workspaceId: _w,
      analysisId: _a,
      index: _i,
      createdAt: _c,
      ...rest
    } = /** @type {Record<string, unknown>} */ (f);
    void _id;
    return /** @type {Finding} */ (rest);
  });
  /** @type {AnalysisResult} */
  const result = {
    schemaVersion: '1.0',
    protocol: /** @type {AnalysisResult['protocol']} */ (a.protocol),
    comparisonMode: /** @type {AnalysisResult['comparisonMode']} */ (a.comparisonMode ?? 'same_protocol'),
    baseline: a.baselineSummary,
    candidate: a.candidateSummary,
    findings: clean,
    uncoveredConstructs: a.uncoveredConstructs ?? [],
    parserWarnings: a.parserWarnings ?? [],
    coverage: a.coverage,
    gate: a.gate,
    engineVersion: a.versions?.engine ?? '?',
    ruleRegistryVersion: a.versions?.rules ?? '?',
    adapterVersion: a.versions?.adapter ?? '?',
    policyVersion: a.versions?.policy ?? '?',
    options: a.options ?? {},
  };
  /** @type {ReportContext} */
  const ctx = {
    analysisId: a._id.toString(),
    projectName: project.name,
    ...(workspace ? { workspaceName: workspace.name } : {}),
    createdAt: new Date(a.createdAt).toISOString(),
    exportedAt: new Date().toISOString(),
    baseline: {
      id: bv._id.toString(),
      label: bv.label,
      rawHash: bv.rawHash,
      ...(bv.fileName ? { fileName: bv.fileName } : {}),
    },
    candidate: {
      id: cv._id.toString(),
      label: cv.label,
      rawHash: cv.rawHash,
      ...(cv.fileName ? { fileName: cv.fileName } : {}),
    },
    result,
    impact: await loadImpact(a),
    reviews: reviews.map((r) => ({
      reviewer: names.get(r.reviewerId.toString()) ?? 'Unknown',
      decision: r.decision,
      rationale: r.rationale,
      createdAt: new Date(r.createdAt).toISOString(),
    })),
    ...(a.policyName ? { policyName: a.policyName } : {}),
  };
  return { ctx, projectSlug: project.slug };
}

/**
 * @param {string} projectSlug
 * @param {string} analysisId
 * @param {string} ext
 * @param {string} engine
 */
export function reportFileName(projectSlug, analysisId, ext, engine) {
  const date = new Date().toISOString().slice(0, 10);
  return `jky-radar_${slugify(projectSlug)}_${analysisId.slice(-8)}_${date}_engine-${engine.replace(/[^0-9.]/g, '')}.${ext}`;
}

/** @param {ReportContext} ctx */
export const renderJson = (ctx) => JSON.stringify(buildJsonReport(ctx), null, 2);
/** @param {ReportContext} ctx */
export const renderMarkdown = (ctx) => buildMarkdownReport(ctx);

/* ------------------------------------------------------------------ PDF */

const COLORS = /** @type {const} */ ({
  ink: '#0f1115',
  muted: '#5b6270',
  line: '#e3e6ec',
  brand: '#3b5bfd',
  pass: '#0f9f6e',
  warn: '#b7791f',
  block: '#d63b3b',
  inconclusive: '#6b5bd6',
  breaking: '#d63b3b',
  potentially_breaking: '#d9822b',
  needs_review: '#b7791f',
  non_breaking: '#0f9f6e',
  informational: '#5b6270',
});

/**
 * Standard PDF fonts use WinAnsi; map characters outside it.
 * @param {unknown} s
 */
const pdfText = (s) => {
  const mapped = String(s ?? '')
    .replace(/[→⇒]/g, '->')
    .replace(/←/g, '<-')
    .replace(/›/g, '>')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
  // Keep printable ASCII, Latin-1 and a few WinAnsi punctuation marks; replace everything else.
  let out = '';
  for (const ch of mapped) {
    const c = ch.codePointAt(0);
    const ok =
      c === 9 ||
      c === 10 ||
      c === 13 ||
      (c >= 32 && c <= 126) ||
      (c >= 160 && c <= 255) ||
      '…–—•'.includes(ch);
    out += ok ? ch : '?';
  }
  return out;
};

/**
 * @param {ReportContext} ctx
 * @returns {Promise<Buffer>}
 */
export function renderPdf(ctx) {
  const r = ctx.result;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    bufferPages: true,
    info: {
      Title: `JKY-Radar report — ${ctx.projectName}`,
      Author: 'JKY-Radar',
      Subject: 'API compatibility report',
    },
  });
  /** @type {Buffer[]} */
  const chunks = [];
  doc.on('data', /** @param {Buffer} c */ (c) => chunks.push(c));
  const done = /** @type {Promise<Buffer>} */ (
    new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))
  );
  const W = doc.page.width - 96;

  // Header band
  doc.rect(0, 0, doc.page.width, 92).fill(COLORS.ink);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('JKY-Radar', 48, 30);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#aab3c5')
    .text('One Radar. Every API. Know What Breaks Before You Ship.', 48, 56);
  doc
    .fillColor('#aab3c5')
    .fontSize(9)
    .text(`Exported ${ctx.exportedAt.slice(0, 19).replace('T', ' ')} UTC`, 48, 30, {
      width: W,
      align: 'right',
    });
  doc.y = 116;

  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(pdfText(`Compatibility report — ${ctx.projectName}`), 48);
  doc.moveDown(0.3);
  doc
    .font('Helvetica')
    .fontSize(10)
    .fillColor(COLORS.muted)
    .text(
      pdfText(
        `${PROTOCOL_LABEL[r.protocol]} · ${ctx.baseline.label} -> ${ctx.candidate.label} · analysis ${ctx.analysisId}`,
      ),
    );
  doc.moveDown(0.8);

  // Gate badge
  const gateColor = COLORS[r.gate.decision];
  const y0 = doc.y;
  doc.roundedRect(48, y0, W, 64, 8).fill('#f6f7fb');
  doc.roundedRect(60, y0 + 14, 120, 36, 6).fill(gateColor);
  doc
    .fillColor('#ffffff')
    .font('Helvetica-Bold')
    .fontSize(15)
    .text(GATE_LABEL[r.gate.decision], 60, y0 + 25, { width: 120, align: 'center' });
  doc
    .fillColor(COLORS.ink)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('Release gate', 196, y0 + 14);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(pdfText(r.gate.reasons.join(' ')), 196, y0 + 28, { width: W - 160, height: 32, ellipsis: true });
  doc.y = y0 + 80;

  // Severity counts
  const counts = r.gate.counts;
  const colW = W / 5;
  SEVERITIES.forEach((s, i) => {
    const x = 48 + i * colW;
    doc
      .fillColor(COLORS[s])
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(String(counts[s]), x, doc.y, { width: colW - 8, lineBreak: false });
  });
  doc.moveDown(1.3);
  const ly = doc.y;
  SEVERITIES.forEach((s, i) =>
    doc
      .fillColor(COLORS.muted)
      .font('Helvetica')
      .fontSize(8)
      .text(SEVERITY_LABEL[s].toUpperCase(), 48 + i * colW, ly, { width: colW - 8 }),
  );
  doc.y = ly + 22;

  /** @param {string} title */
  const section = (title) => {
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.moveDown(0.6);
    doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(12).text(title, 48);
    doc
      .moveTo(48, doc.y + 3)
      .lineTo(48 + W, doc.y + 3)
      .strokeColor(COLORS.line)
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.6);
  };
  /**
   * @param {string} k
   * @param {string} v
   */
  const kv = (k, v) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(COLORS.muted)
      .text(k, 48, doc.y, { continued: true, width: W });
    doc
      .font('Helvetica')
      .fillColor(COLORS.ink)
      .text(`  ${pdfText(v)}`);
  };

  section('Scope and fingerprints');
  kv('Baseline', `${ctx.baseline.label} (${r.baseline.protocol} ${r.baseline.formatVersion})`);
  kv('  SHA-256', ctx.baseline.rawHash);
  kv('Candidate', `${ctx.candidate.label} (${r.candidate.protocol} ${r.candidate.formatVersion})`);
  kv('  SHA-256', ctx.candidate.rawHash);
  kv(
    'Coverage',
    `${r.coverage.level} — ${r.coverage.testedRules}/${r.coverage.supportedRules} rules for this protocol have positive and negative tests`,
  );
  kv(
    'Versions',
    `engine ${r.engineVersion} · rules ${r.ruleRegistryVersion} · adapter ${r.adapterVersion} · policy ${r.policyVersion}`,
  );

  /** @type {Array<[string, Finding[]]>} */
  const groups = [
    ['Breaking changes', r.findings.filter((f) => f.severity === 'breaking')],
    [
      'Potentially breaking and needs review',
      r.findings.filter((f) => f.severity === 'potentially_breaking' || f.severity === 'needs_review'),
    ],
    [
      'Non-breaking and informational',
      r.findings.filter((f) => f.severity === 'non_breaking' || f.severity === 'informational'),
    ],
  ];
  for (const [title, list] of groups) {
    if (list.length === 0) continue;
    section(`${title} (${list.length})`);
    for (const f of list.slice(0, 400)) {
      if (doc.y > doc.page.height - 120) doc.addPage();
      const top = doc.y;
      doc.rect(48, top, 3, 12).fill(COLORS[f.severity]);
      doc
        .fillColor(COLORS.ink)
        .font('Helvetica-Bold')
        .fontSize(9.5)
        .text(pdfText(`${f.title}  ·  ${f.ruleId}`), 58, top, { width: W - 10 });
      doc
        .font('Courier')
        .fontSize(8)
        .fillColor(COLORS.brand)
        .text(pdfText(f.logicalPath), 58, doc.y, { width: W - 10 });
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.ink)
        .text(pdfText(f.explanation), 58, doc.y, { width: W - 10 });
      if (f.before !== undefined || f.after !== undefined) {
        doc
          .font('Courier')
          .fontSize(7.5)
          .fillColor(COLORS.muted)
          .text(pdfText(`before: ${preview(f.before, 90)}   after: ${preview(f.after, 90)}`), 58, doc.y, {
            width: W - 10,
          });
      }
      const loc = [
        f.baselineSource?.line ? `baseline line ${f.baselineSource.line}` : '',
        f.candidateSource?.line ? `candidate line ${f.candidateSource.line}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      doc
        .font('Helvetica-Oblique')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(pdfText(`Fix: ${f.recommendation}${loc ? `  (${loc})` : ''}`), 58, doc.y, { width: W - 10 });
      doc.moveDown(0.5);
    }
    if (list.length > 400)
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(COLORS.muted)
        .text(`… ${list.length - 400} more in the JSON report.`);
  }
  if (r.findings.length === 0) {
    section('Findings');
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(
        r.coverage.level === 'full'
          ? 'No differences were detected by the tested rules.'
          : 'No findings, but coverage is not full — this is not proof of compatibility.',
      );
  }

  if (ctx.impact) {
    section('Consumer impact (registered consumers only)');
    const impacted = ctx.impact.consumers.filter((c) => c.known.length || c.potential.length);
    if (impacted.length === 0)
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor(COLORS.ink)
        .text('No registered consumer depends on a changed operation.');
    for (const c of impacted) {
      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor(COLORS.ink)
        .text(pdfText(`${c.name}  (${c.criticality})`), 48, doc.y, { continued: true });
      doc
        .font('Helvetica')
        .fillColor(COLORS.muted)
        .text(
          pdfText(
            `  known ${c.known.length} · potential ${c.potential.length}${c.owner ? ` · owner ${c.owner}` : ''}`,
          ),
        );
    }
    doc.moveDown(0.3);
    doc
      .font('Helvetica-Oblique')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(pdfText(ctx.impact.disclaimer), { width: W });
  }

  section('Review decisions');
  if (!ctx.reviews?.length)
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink).text('No review decision recorded yet.');
  for (const rv of ctx.reviews ?? [])
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor(COLORS.ink)
      .text(
        pdfText(
          `${rv.createdAt.slice(0, 16).replace('T', ' ')} — ${rv.decision.toUpperCase()} by ${rv.reviewer}: ${rv.rationale}`,
        ),
        { width: W },
      );

  section('Limitations');
  for (const l of LIMITATIONS)
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor(COLORS.muted)
      .text(`•  ${pdfText(l)}`, { width: W });
  if (r.uncoveredConstructs.length) {
    doc.moveDown(0.3);
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .fillColor(COLORS.ink)
      .text('Not semantically compared in these inputs:');
    for (const c of r.uncoveredConstructs)
      doc
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor(COLORS.muted)
        .text(`•  ${pdfText(c)}`, { width: W });
  }

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 30;
    doc.page.margins.bottom = 0;
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor(COLORS.muted)
      .text(pdfText(`JKY-Radar · ${ctx.projectName} · engine ${r.engineVersion}`), 48, bottom, {
        width: W / 2,
        lineBreak: false,
      });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, 48 + W / 2, bottom, {
      width: W / 2,
      align: 'right',
      lineBreak: false,
    });
  }
  doc.end();
  return done;
}
