/** @import { Types } from 'mongoose' */
/** @import { AnalyzeOutcome } from '@jky/radar-adapters' */
/** @import { Protocol } from '@jky/radar-core' */
/** @import { Env } from '../config/env.js' */
/** @import { AnalysisTask } from '../workers/analysis-task.js' */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { Analysis, FindingModel, Project, SpecFile, SpecVersion } from '../models/index.js';
import { logger } from '../lib/logger.js';
import { runAnalysisTask } from '../workers/analysis-task.js';
import { notifyRole, notifyUsers } from './notify.js';
import { audit } from './audit.js';

/** @typedef {{ kind: 'ok'; out: AnalyzeOutcome } | { kind: 'error'; code: string; message: string }} Outcome */

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The worker is plain JavaScript and runs directly from source.
 * @returns {{ source: string } | null}
 */
function workerEntry() {
  const js = path.join(here, '../workers/analysis-worker.js');
  return existsSync(js) ? { source: js } : null;
}

/**
 * @param {AnalysisTask} task
 * @param {number} timeoutMs
 * @returns {Promise<Outcome>}
 */
function runInWorker(task, timeoutMs) {
  const entry = workerEntry();
  if (!entry) return Promise.resolve(runInline(task));
  return new Promise((resolve) => {
    const worker = new Worker(entry.source, {
      workerData: task,
      resourceLimits: { maxOldGenerationSizeMb: 384, maxYoungGenerationSizeMb: 64, stackSizeMb: 8 },
    });
    let settled = false;
    /** @param {Outcome} o */
    const done = (o) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(o);
    };
    const timer = setTimeout(
      () =>
        done({
          kind: 'error',
          code: 'ANALYSIS_TIMEOUT',
          message: `Analysis exceeded the ${timeoutMs} ms time limit and was stopped.`,
        }),
      timeoutMs,
    );
    worker.once(
      'message',
      /** @param {{ ok: boolean; out?: AnalyzeOutcome; message?: string }} m */ (m) =>
        done(
          m.ok && m.out
            ? { kind: 'ok', out: m.out }
            : { kind: 'error', code: 'ANALYSIS_FAILED', message: m.message ?? 'Analysis failed' },
        ),
    );
    worker.once('error', (e) => {
      logger.error('analysis worker error', { err: e.message });
      done({
        kind: 'error',
        code: /memory/i.test(e.message) ? 'ANALYSIS_RESOURCE_LIMIT' : 'ANALYSIS_FAILED',
        message: /memory/i.test(e.message)
          ? 'Analysis exceeded the memory limit.'
          : 'The analysis worker crashed.',
      });
    });
    worker.once('exit', (code) => {
      if (code !== 0)
        done({ kind: 'error', code: 'ANALYSIS_FAILED', message: 'The analysis worker exited unexpectedly.' });
    });
  });
}

/**
 * @param {AnalysisTask} task
 * @returns {Outcome}
 */
function runInline(task) {
  try {
    return { kind: 'ok', out: runAnalysisTask(task) };
  } catch (e) {
    return {
      kind: 'error',
      code: 'ANALYSIS_FAILED',
      message: /** @type {Error} */ (e).message.slice(0, 300),
    };
  }
}

/**
 * In-process queue with bounded concurrency. State lives in MongoDB, so queued or
 * interrupted analyses are re-queued on startup (deterministic: same inputs → same result).
 */
export class AnalysisRunner {
  /** @type {string[]} */
  queue = [];
  active = 0;
  waiters = /** @type {Map<string, Array<() => void>>} */ (new Map());

  /** @param {Env} env */
  constructor(env) {
    /** @type {Env} */
    this.env = env;
  }

  /**
   * @param {string} id
   * @returns {void}
   */
  enqueue(id) {
    if (!this.queue.includes(id)) this.queue.push(id);
    this.pump();
  }

  /**
   * Resolves when the given analysis finished processing in this process (tests / seeding).
   * @param {string} id
   * @returns {Promise<void>}
   */
  waitFor(id) {
    return new Promise((resolve) => {
      const list = this.waiters.get(id) ?? [];
      list.push(resolve);
      this.waiters.set(id, list);
    });
  }

  /** @returns {Promise<number>} */
  async resumePending() {
    const pending = await Analysis.find({ state: { $in: ['queued', 'running'] } })
      .select('_id')
      .lean();
    for (const a of pending) {
      await FindingModel.deleteMany({ analysisId: a._id });
      await Analysis.updateOne({ _id: a._id }, { $set: { state: 'queued', stage: 'queued' } });
      this.enqueue(a._id.toString());
    }
    if (pending.length) logger.info('resumed pending analyses', { count: pending.length });
    return pending.length;
  }

  pump() {
    while (this.active < this.env.ANALYSIS_CONCURRENCY && this.queue.length > 0) {
      const id = this.queue.shift();
      this.active++;
      this.process(id)
        .catch((e) =>
          logger.error('analysis processing failed', { id, err: /** @type {Error} */ (e).message }),
        )
        .finally(() => {
          this.active--;
          for (const w of this.waiters.get(id) ?? []) w();
          this.waiters.delete(id);
          this.pump();
        });
    }
  }

  /**
   * @param {string} id
   * @returns {Promise<void>}
   */
  async process(id) {
    const analysis = await Analysis.findById(id);
    if (!analysis || analysis.state === 'completed') return;
    const startedAt = new Date();
    await Analysis.updateOne(
      { _id: analysis._id },
      { $set: { state: 'running', stage: 'parsing', 'timings.startedAt': startedAt }, $inc: { attempts: 1 } },
    );

    const [bv, cv] = await Promise.all([
      SpecVersion.findById(analysis.baselineId),
      SpecVersion.findById(analysis.candidateId),
    ]);
    if (!bv || !cv) return this.fail(analysis._id, 'VERSION_MISSING', 'A compared version no longer exists.');
    const [bf, cf] = await Promise.all([SpecFile.findById(bv.specFileId), SpecFile.findById(cv.specFileId)]);
    if (!bf || !cf) return this.fail(analysis._id, 'VERSION_MISSING', 'Stored contract content is missing.');

    /** @type {AnalysisTask} */
    const task = {
      baseline: {
        content: bf.content,
        protocol: /** @type {Protocol} */ (bv.protocol),
        ...(bv.fileName ? { fileName: bv.fileName } : {}),
      },
      candidate: {
        content: cf.content,
        protocol: /** @type {Protocol} */ (cv.protocol),
        ...(cv.fileName ? { fileName: cv.fileName } : {}),
      },
      options: analysis.options ?? {},
      policy: analysis.policySnapshot,
      maxBytes: this.env.MAX_SPEC_BYTES,
    };
    await Analysis.updateOne({ _id: analysis._id }, { $set: { stage: 'comparing' } });
    const outcome =
      this.env.ANALYSIS_ISOLATION === 'worker'
        ? await runInWorker(task, this.env.ANALYSIS_TIMEOUT_MS)
        : runInline(task);
    if (outcome.kind === 'error') return this.fail(analysis._id, outcome.code, outcome.message);
    if (outcome.out.ok === false) {
      return this.fail(analysis._id, outcome.out.code, outcome.out.message, {
        baseline: outcome.out.baseline,
        candidate: outcome.out.candidate,
      });
    }
    const r = outcome.out.result;
    await Analysis.updateOne({ _id: analysis._id }, { $set: { stage: 'persisting' } });
    await FindingModel.deleteMany({ analysisId: analysis._id });
    const docs = r.findings.map((f, index) => ({
      ...f,
      workspaceId: analysis.workspaceId,
      analysisId: analysis._id,
      index,
    }));
    for (let i = 0; i < docs.length; i += 500)
      await FindingModel.insertMany(docs.slice(i, i + 500), { ordered: true });

    const completedAt = new Date();
    const policy = /** @type {{ requireReview?: boolean } | undefined} */ (analysis.policySnapshot);
    const reviewStatus = policy?.requireReview === false ? 'not_required' : 'pending';
    await Analysis.updateOne(
      { _id: analysis._id },
      {
        $set: {
          state: 'completed',
          stage: 'done',
          gate: r.gate,
          coverage: r.coverage,
          counts: r.gate.counts,
          baselineSummary: r.baseline,
          candidateSummary: r.candidate,
          uncoveredConstructs: r.uncoveredConstructs,
          parserWarnings: r.parserWarnings.slice(0, 300),
          comparisonMode: r.comparisonMode,
          options: r.options,
          versions: {
            engine: r.engineVersion,
            rules: r.ruleRegistryVersion,
            adapter: r.adapterVersion,
            policy: r.policyVersion,
          },
          findingCount: r.findings.length,
          reviewStatus,
          'timings.completedAt': completedAt,
          'timings.durationMs': completedAt.getTime() - startedAt.getTime(),
        },
      },
    );
    await Project.updateOne({ _id: analysis.projectId }, { $set: { latestAnalysisId: analysis._id } });
    await audit(null, {
      workspaceId: analysis.workspaceId,
      actorId: analysis.createdBy,
      action: 'analysis.completed',
      resourceType: 'analysis',
      resourceId: analysis._id,
      metadata: { gate: r.gate.decision, findings: r.findings.length, coverage: r.coverage.level },
    });
    if (!analysis.isPublicDemo) {
      const link = `/app/analyses/${analysis._id.toString()}`;
      await notifyUsers([analysis.createdBy], {
        workspaceId: analysis.workspaceId,
        kind: 'analysis.completed',
        title: `Radar analysis finished: ${r.gate.decision.toUpperCase()}`,
        body: `${bv.label} → ${cv.label} produced ${r.findings.length} finding(s).`,
        link,
      });
      if (reviewStatus === 'pending') {
        await notifyRole(analysis.workspaceId, 'REVIEWER', analysis.createdBy, {
          kind: 'review.requested',
          title: 'Release review requested',
          body: `${bv.label} → ${cv.label}: gate ${r.gate.decision.toUpperCase()}.`,
          link: `${link}/reviews`,
        });
      }
    }
  }

  /**
   * @param {Types.ObjectId} id
   * @param {string} code
   * @param {string} message
   * @param {unknown} [details]
   */
  async fail(id, code, message, details) {
    const a = await Analysis.findByIdAndUpdate(
      id,
      {
        $set: {
          state: 'failed',
          stage: 'done',
          error: { code, message, details },
          'timings.completedAt': new Date(),
        },
      },
      { new: true },
    );
    if (a) {
      await audit(null, {
        workspaceId: a.workspaceId,
        actorId: a.createdBy,
        action: 'analysis.failed',
        resourceType: 'analysis',
        resourceId: a._id,
        metadata: { code },
      });
      if (!a.isPublicDemo)
        await notifyUsers([a.createdBy], {
          workspaceId: a.workspaceId,
          kind: 'analysis.failed',
          title: 'Radar analysis failed',
          body: message,
          link: `/app/analyses/${a._id.toString()}`,
        });
    }
  }
}
