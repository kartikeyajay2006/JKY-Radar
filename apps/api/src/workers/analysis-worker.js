import { parentPort, workerData } from 'node:worker_threads';
import { runAnalysisTask } from './analysis-task.js';

/** @import { AnalysisTask } from './analysis-task.js' */

try {
  const out = runAnalysisTask(/** @type {AnalysisTask} */ (workerData));
  parentPort?.postMessage({ ok: true, out });
} catch (e) {
  parentPort?.postMessage({ ok: false, message: /** @type {Error} */ (e).message });
}
