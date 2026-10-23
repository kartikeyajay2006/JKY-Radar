/** @import { Types } from 'mongoose' */
/** @import { Protocol } from '@jky/radar-core' */

import { parseContract, parseStructured, redactSecrets, DEFAULT_LIMITS } from '@jky/radar-adapters';
import { canonicalJson, PROTOCOL_FAMILY, PROTOCOL_LABEL } from '@jky/radar-core';
import { LIMITS } from '@jky/shared';
import { Project, SpecFile, SpecVersion } from '../models/index.js';
import { AppError, conflict, quotaExceeded } from '../lib/errors.js';
import { sha256 } from '../lib/crypto.js';

/**
 * @typedef {Object} NewVersionInput
 * @property {string} label
 * @property {string} content
 * @property {string} [fileName]
 * @property {Protocol} [protocol]
 * @property {string} [notes]
 */

/**
 * @param {{ _id: Types.ObjectId; workspaceId: Types.ObjectId; protocol: string }} project
 * @param {Types.ObjectId} userId
 * @param {NewVersionInput} input
 * @param {number} maxBytes
 */
export async function createVersion(project, userId, input, maxBytes) {
  const size = Buffer.byteLength(input.content, 'utf8');
  if (size > maxBytes)
    throw new AppError(
      413,
      'PAYLOAD_TOO_LARGE',
      `Contract is ${size} bytes; the limit is ${maxBytes} bytes.`,
    );
  const count = await SpecVersion.countDocuments({ projectId: project._id });
  if (count >= LIMITS.maxVersionsPerProject)
    throw quotaExceeded(`A project can hold at most ${LIMITS.maxVersionsPerProject} versions.`);

  // Secrets are removed before anything is parsed, hashed or stored.
  const redaction = redactSecrets(input.content);
  const content = redaction.content;
  const projectProtocol = /** @type {Protocol} */ (project.protocol);
  const outcome = parseContract(
    {
      content,
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.protocol ? { protocol: input.protocol } : {}),
    },
    { ...DEFAULT_LIMITS, maxBytes },
  );
  if (outcome.ok === false) {
    throw new AppError(
      422,
      outcome.diagnostics.some((d) => d.code === 'PROTOCOL_MISMATCH')
        ? 'PROTOCOL_MISMATCH'
        : 'INVALID_CONTRACT',
      outcome.diagnostics[0]?.message ?? 'Invalid contract',
      {
        diagnostics: outcome.diagnostics,
        detection: {
          protocol: outcome.detection.protocol,
          confidence: outcome.detection.confidence,
          reasons: outcome.detection.reasons,
        },
      },
    );
  }
  const c = outcome.contract;
  if (PROTOCOL_FAMILY[c.protocol] !== PROTOCOL_FAMILY[projectProtocol]) {
    throw new AppError(
      422,
      'PROTOCOL_MISMATCH',
      `This project tracks ${PROTOCOL_LABEL[projectProtocol]} contracts, but the upload is ${PROTOCOL_LABEL[c.protocol]}.`,
      {
        detection: { protocol: c.protocol, reasons: outcome.detection.reasons },
      },
    );
  }

  const rawHash = sha256(content);
  /** @type {string} */
  let normalizedHash;
  try {
    normalizedHash =
      outcome.detection.syntax === 'json' || outcome.detection.syntax === 'yaml'
        ? sha256(canonicalJson(parseStructured(content, { ...DEFAULT_LIMITS, maxBytes }).value))
        : sha256(content.replace(/\s+/g, ' ').trim());
  } catch {
    normalizedHash = rawHash;
  }

  const existing = await SpecVersion.findOne({ projectId: project._id, rawHash }).select('_id label').lean();
  if (existing)
    throw conflict(`This exact content was already uploaded as "${existing.label}".`, {
      existingVersionId: existing._id.toString(),
    });

  const file = await SpecFile.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    content,
    size: Buffer.byteLength(content, 'utf8'),
  });
  const version = await SpecVersion.create({
    workspaceId: project.workspaceId,
    projectId: project._id,
    label: input.label,
    protocol: c.protocol,
    formatVersion: c.formatVersion,
    title: c.title,
    apiVersion: c.version,
    fileName: input.fileName,
    notes: input.notes,
    size,
    rawHash,
    normalizedHash,
    specFileId: file._id,
    stats: c.stats,
    diagnostics: c.diagnostics.slice(0, 200),
    ignoredConstructs: c.ignoredConstructs,
    redactions: redaction.redactions.slice(0, 200),
    detection: {
      confidence: outcome.detection.confidence,
      reasons: outcome.detection.reasons,
      overridden: !!input.protocol && input.protocol !== outcome.detection.protocol,
    },
    uploadedBy: userId,
  });
  await Project.updateOne(
    { _id: project._id },
    { $set: { latestVersionId: version._id }, $inc: { versionCount: 1 } },
  );
  return version;
}
