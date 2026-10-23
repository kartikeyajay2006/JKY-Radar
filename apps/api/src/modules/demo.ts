import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { Analysis, Project, SpecVersion } from '../models/index.js';
import { asyncHandler, sendData } from '../lib/http.js';
import { notFound } from '../lib/errors.js';
import { loadImpact } from '../services/reports.js';
import { analysisSummaryDTO, userNames } from '../services/serialize.js';
import { reviewList, sendAnalysis, sendFindings, sendReport, sendSources } from './analyses.js';

/** Public, read-only access to deliberately published demo analyses only. */
async function demoAnalysis(id: string) {
  if (!isValidObjectId(id)) throw notFound('Demo analysis');
  const a = await Analysis.findOne({ _id: id, isPublicDemo: true, state: 'completed' });
  if (!a) throw notFound('Demo analysis');
  return a;
}

export function demoRouter() {
  const r = Router();
  // Only the public demo is cacheable; everything else stays no-store.
  r.use('/demo', (_req, res, next) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    next();
  });
  r.get(
    '/demo/analyses',
    asyncHandler(async (_req, res) => {
      const items = await Analysis.find({ isPublicDemo: true, state: 'completed' })
        .sort({ createdAt: 1 })
        .lean();
      const labels = await SpecVersion.find({
        _id: { $in: items.flatMap((a) => [a.baselineId, a.candidateId]) },
      })
        .select('label')
        .lean();
      const lm = new Map(labels.map((v) => [v._id.toString(), v.label]));
      const projects = await Project.find({ _id: { $in: items.map((a) => a.projectId) } })
        .select('name description')
        .lean();
      const names = await userNames(items.map((a) => a.createdBy));
      sendData(
        res,
        items.map((a) => ({
          ...analysisSummaryDTO(a, lm, names, projects.find((p) => p._id.equals(a.projectId))?.name),
          description: projects.find((p) => p._id.equals(a.projectId))?.description ?? '',
        })),
      );
    }),
  );
  r.get(
    '/demo/analyses/:aid',
    asyncHandler(async (req, res) =>
      sendAnalysis(res, (await demoAnalysis(String(req.params.aid))).toObject()),
    ),
  );
  r.get(
    '/demo/analyses/:aid/findings',
    asyncHandler(async (req, res) =>
      sendFindings(req, res, (await demoAnalysis(String(req.params.aid)))._id),
    ),
  );
  r.get(
    '/demo/analyses/:aid/impact',
    asyncHandler(async (req, res) =>
      sendData(res, await loadImpact(await demoAnalysis(String(req.params.aid)))),
    ),
  );
  r.get(
    '/demo/analyses/:aid/sources',
    asyncHandler(async (req, res) => sendSources(res, await demoAnalysis(String(req.params.aid)))),
  );
  r.get(
    '/demo/analyses/:aid/reviews',
    asyncHandler(async (req, res) =>
      sendData(res, await reviewList((await demoAnalysis(String(req.params.aid)))._id)),
    ),
  );
  r.get(
    '/demo/analyses/:aid/report',
    asyncHandler(async (req, res) => sendReport(req, res, await demoAnalysis(String(req.params.aid)))),
  );
  return r;
}
