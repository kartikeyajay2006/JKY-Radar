import { loadEnv } from '../config/env.js';
import { connectDb, disconnectDb } from '../db.js';
import { ensureIndexes } from '../models/index.js';
import { AnalysisRunner } from '../services/analysis-runner.js';
import { seedDemo } from '../services/demo-seed.js';

const env = loadEnv({ ...process.env, ANALYSIS_ISOLATION: process.env.ANALYSIS_ISOLATION ?? 'inline' });
await connectDb(env.MONGODB_URI);
await ensureIndexes();
const result = await seedDemo(new AnalysisRunner(env), env.MAX_SPEC_BYTES);
console.log(`Demo seed: ${result.status} (${result.analyses} analyses)`);
await disconnectDb();
