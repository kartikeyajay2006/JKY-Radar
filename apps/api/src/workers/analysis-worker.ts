import { parentPort, workerData } from 'node:worker_threads';
import { runAnalysisTask, type AnalysisTask } from './analysis-task.js';

try {
  const out = runAnalysisTask(workerData as AnalysisTask);
  parentPort?.postMessage({ ok: true, out });
} catch (e) {
  parentPort?.postMessage({ ok: false, message: (e as Error).message });
}
