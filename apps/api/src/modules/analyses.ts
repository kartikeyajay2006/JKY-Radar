import { Router, type Request, type Response } from 'express';
import type { Types } from 'mongoose';
import { createReviewSchema, findingsQuery, reportQuery, type ReviewDTO } from '@jky/shared';
import { Analysis, FindingModel, Project, Review, SpecFile, SpecVersion } from '../models/index.js';
import { asyncHandler, escapeRegex, parse, sendData } from '../lib/http.js';
import { AppError, conflict, forbidden, notFound } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { loadAnalysis } from '../services/access.js';
import { audit } from '../services/audit.js';
import { notifyUsers } from '../services/notify.js';
import {
  buildReportContext,
  loadImpact,
  renderJson,
  renderMarkdown,
  renderPdf,
  reportFileName,
} from '../services/reports.js';
import { analysisDTO, findingDTO, userNames } from '../services/serialize.js';

type AnalysisLike = {
  _id: Types.ObjectId;
  baselineId: Types.ObjectId;
  candidateId: Types.ObjectId;
  createdBy: Types.ObjectId;
  state: string;
  projectId: Types.ObjectId;
};

export async function sendAnalysis(res: Response, a: AnalysisLike & Record<string, unknown>) {
  const [bv, cv] = await Promise.all([
    SpecVersion.findById(a.baselineId).lean(),
    SpecVersion.findById(a.candidateId).lean(),
  ]);
  if (!bv || !cv) throw notFound('Analysis inputs');
  const [names, project] = await Promise.all([
    userNames([a.createdBy]),
    Project.findById(a.projectId).select('name').lean(),
  ]);
  sendData(res, { ...analysisDTO(a, bv, cv, names), ...(project ? { projectName: project.name } : {}) });
}

export async function sendFindings(req: Request, res: Response, analysisId: Types.ObjectId) {
  const q = parse(findingsQuery, req.query);
  const filter: Record<string, unknown> = { analysisId };
  if (q.severity?.length) filter.severity = { $in: q.severity };
  if (q.ruleId) filter.ruleId = q.ruleId;
  if (q.entity) filter.entityKey = q.entity;
  if (q.search) {
    const rx = { $regex: escapeRegex(q.search), $options: 'i' };
    filter.$or = [{ logicalPath: rx }, { title: rx }, { explanation: rx }, { ruleId: rx }];
  }
  const [items, total, bySeverity, byRule] = await Promise.all([
    FindingModel.find(filter)
      .sort({ index: 1 })
      .skip((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .lean(),
    FindingModel.countDocuments(filter),
    FindingModel.aggregate<{ _id: string; n: number }>([
      { $match: { analysisId } },
      { $group: { _id: '$severity', n: { $sum: 1 } } },
    ]),
    FindingModel.aggregate<{ _id: string; n: number }>([
      { $match: { analysisId } },
      { $group: { _id: '$ruleId', n: { $sum: 1 } } },
      { $sort: { n: -1, _id: 1 } },
    ]),
  ]);
  sendData(res, items.map(findingDTO), 200, {
    page: q.page,
    pageSize: q.pageSize,
    total,
    totalPages: Math.ceil(total / q.pageSize),
    facets: {
      severity: Object.fromEntries(bySeverity.map((x) => [x._id, x.n])),
      rules: byRule.map((x) => ({ ruleId: x._id, count: x.n })),
    },
  });
}

export async function sendSources(res: Response, a: AnalysisLike) {
  const [bv, cv] = await Promise.all([
    SpecVersion.findById(a.baselineId).lean(),
    SpecVersion.findById(a.candidateId).lean(),
  ]);
  if (!bv || !cv) throw notFound('Analysis inputs');
  const [bf, cf] = await Promise.all([
    SpecFile.findById(bv.specFileId).lean(),
    SpecFile.findById(cv.specFileId).lean(),
  ]);
  if (!bf || !cf) throw notFound('Stored contract');
  sendData(res, {
    baseline: {
      versionId: bv._id.toString(),
      label: bv.label,
      fileName: bv.fileName ?? null,
      content: bf.content,
    },
    candidate: {
      versionId: cv._id.toString(),
      label: cv.label,
      fileName: cv.fileName ?? null,
      content: cf.content,
    },
  });
}

export async function sendReport(req: Request, res: Response, a: AnalysisLike) {
  const { format } = parse(reportQuery, req.query);
  if (a.state !== 'completed') throw new AppError(409, 'CONFLICT', 'The analysis has not completed yet.');
  const { ctx, projectSlug } = await buildReportContext(a._id);
  const name = reportFileName(projectSlug, ctx.analysisId, format, ctx.result.engineVersion);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Cache-Control', 'no-store');
  if (format === 'json') return void res.type('application/json').send(renderJson(ctx));
  if (format === 'md') return void res.type('text/markdown; charset=utf-8').send(renderMarkdown(ctx));
  const pdf = await renderPdf(ctx);
  res.type('application/pdf').send(pdf);
}

export async function reviewList(analysisId: Types.ObjectId): Promise<ReviewDTO[]> {
  const reviews = await Review.find({ analysisId }).sort({ createdAt: 1 }).lean();
  const names = await userNames(reviews.map((r) => r.reviewerId));
  return reviews.map((r) => ({
    id: r._id.toString(),
    analysisId: r.analysisId.toString(),
    reviewer: { id: r.reviewerId.toString(), name: names.get(r.reviewerId.toString()) ?? 'Unknown' },
    decision: r.decision as ReviewDTO['decision'],
    rationale: r.rationale,
    overrideBlock: !!r.overrideBlock,
    createdAt: new Date(r.createdAt).toISOString(),
  }));
}

export function analysesRouter() {
  const r = Router();
  r.use('/analyses', requireAuth);

  r.get(
    '/analyses/:aid',
    asyncHandler(async (req, res) => {
      const { analysis } = await loadAnalysis(req, String(req.params.aid));
      await sendAnalysis(res, analysis.toObject());
    }),
  );

  r.get(
    '/analyses/:aid/findings',
    asyncHandler(async (req, res) => {
      const { analysis } = await loadAnalysis(req, String(req.params.aid));
      await sendFindings(req, res, analysis._id);
    }),
  );

  r.get(
    '/analyses/:aid/impact',
    asyncHandler(async (req, res) => {
      const { analysis } = await loadAnalysis(req, String(req.params.aid));
      if (analysis.state !== 'completed')
        throw new AppError(409, 'CONFLICT', 'The analysis has not completed yet.');
      sendData(res, await loadImpact(analysis));
    }),
  );

  r.get(
    '/analyses/:aid/sources',
    asyncHandler(async (req, res) => {
      const { analysis } = await loadAnalysis(req, String(req.params.aid));
      await sendSources(res, analysis);
    }),
  );

  r.get(
    '/analyses/:aid/report',
    asyncHandler(async (req, res) => {
      const { analysis, access } = await loadAnalysis(req, String(req.params.aid));
      await sendReport(req, res, analysis);
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'report.exported',
        resourceType: 'analysis',
        resourceId: analysis._id,
        metadata: { format: String(req.query.format ?? 'json') },
      });
    }),
  );

  r.get(
    '/analyses/:aid/reviews',
    asyncHandler(async (req, res) => {
      const { analysis } = await loadAnalysis(req, String(req.params.aid));
      sendData(res, await reviewList(analysis._id));
    }),
  );

  r.post(
    '/analyses/:aid/reviews',
    asyncHandler(async (req, res) => {
      const { analysis, access } = await loadAnalysis(req, String(req.params.aid), 'review.create');
      const input = parse(createReviewSchema, req.body);
      if (analysis.state !== 'completed') throw conflict('Only completed analyses can be reviewed.');
      const policy = (analysis.policySnapshot ?? {}) as {
        forbidSelfApproval?: boolean;
        minApprovals?: number;
      };
      const decisive = input.decision === 'approve' || input.decision === 'reject';
      if (decisive && policy.forbidSelfApproval !== false && analysis.createdBy.equals(access.userId)) {
        throw forbidden('Policy forbids approving or rejecting an analysis you requested yourself.');
      }
      const gate = (analysis.gate as { decision?: string } | undefined)?.decision;
      if (input.decision === 'approve' && gate === 'block' && !input.overrideBlock) {
        throw new AppError(
          409,
          'CONFLICT',
          'The gate is BLOCK. Approving requires an explicit override with a written rationale (overrideBlock).',
        );
      }
      if (input.overrideBlock && gate !== 'block')
        throw conflict('Override is only valid when the gate is BLOCK.');
      if (input.overrideBlock && !['OWNER', 'ADMIN', 'MAINTAINER', 'REVIEWER'].includes(access.role))
        throw forbidden();

      const review = await Review.create({
        workspaceId: analysis.workspaceId,
        projectId: analysis.projectId,
        analysisId: analysis._id,
        reviewerId: access.userId,
        decision: input.decision,
        rationale: input.rationale,
        overrideBlock: input.overrideBlock,
      });

      // Derive status from each reviewer's latest decisive decision.
      const all = await Review.find({ analysisId: analysis._id, decision: { $ne: 'comment' } })
        .sort({ createdAt: 1 })
        .lean();
      const latest = new Map<string, string>();
      for (const rv of all) latest.set(rv.reviewerId.toString(), rv.decision);
      const decisions = [...latest.values()];
      let status: string = 'pending';
      if (decisions.includes('reject')) status = 'rejected';
      else if (decisions.includes('request_changes')) status = 'changes_requested';
      else if (decisions.filter((d) => d === 'approve').length >= Math.max(1, policy.minApprovals ?? 1))
        status = 'approved';
      await Analysis.updateOne({ _id: analysis._id }, { $set: { reviewStatus: status } });

      await audit(req, {
        workspaceId: access.workspaceId,
        action: input.overrideBlock ? 'gate.override_approved' : `review.${input.decision}`,
        resourceType: 'analysis',
        resourceId: analysis._id,
        metadata: {
          reviewId: review._id.toString(),
          decision: input.decision,
          gate,
          status,
          rationale: input.rationale.slice(0, 300),
        },
      });
      if (!analysis.createdBy.equals(access.userId)) {
        await notifyUsers([analysis.createdBy], {
          workspaceId: access.workspaceId,
          kind: 'review.decision',
          title: `${req.auth!.user.name} ${{ approve: 'approved', reject: 'rejected', request_changes: 'requested changes on', comment: 'commented on' }[input.decision]} your analysis`,
          body: input.rationale.slice(0, 200),
          link: `/app/analyses/${analysis._id.toString()}/reviews`,
        });
      }
      sendData(
        res,
        {
          review: (await reviewList(analysis._id)).find((x) => x.id === review._id.toString()),
          reviewStatus: status,
        },
        201,
      );
    }),
  );

  return r;
}
