/** @import { Env } from '../config/env.js' */
import { Router } from 'express';
import mongoose from 'mongoose';
import { capabilityReport, ADAPTER_VERSION } from '@jky/radar-adapters';
import {
  ENGINE_VERSION,
  RULE_REGISTRY_VERSION,
  ruleRegistry,
  DEFAULT_POLICY,
  LIMITATIONS,
} from '@jky/radar-core';
import { LIMITS, ROLE_DESCRIPTION } from '@jky/shared';

import { sendData } from '../lib/http.js';

/** @param {Env} env */
export function metaRouter(env) {
  const r = Router();
  r.get('/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1 ? 'up' : 'down';
    res
      .status(db === 'up' ? 200 : 503)
      .json({ data: { status: db === 'up' ? 'ok' : 'degraded', db, engineVersion: ENGINE_VERSION } });
  });
  r.get('/capabilities', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    sendData(res, {
      engineVersion: ENGINE_VERSION,
      ruleRegistryVersion: RULE_REGISTRY_VERSION,
      adapterVersion: ADAPTER_VERSION,
      adapters: capabilityReport(),
      limits: { ...LIMITS, maxSpecBytes: env.MAX_SPEC_BYTES, analysisTimeoutMs: env.ANALYSIS_TIMEOUT_MS },
      remoteUrlImport: false,
      defaultPolicy: DEFAULT_POLICY,
      roles: ROLE_DESCRIPTION,
      limitations: LIMITATIONS,
    });
  });
  r.get('/rules', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=300');
    sendData(res, ruleRegistry.all());
  });
  return r;
}
