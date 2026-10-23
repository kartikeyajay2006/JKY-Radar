import { Router } from 'express';
import { normalizeDependencyKey } from '@jky/radar-core';
import { addDependencySchema, LIMITS, updateConsumerSchema } from '@jky/shared';
import { ConsumerDependency } from '../models/index.js';
import { asyncHandler, parse, sendData } from '../lib/http.js';
import { conflict, notFound, quotaExceeded } from '../lib/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { loadConsumer, oid } from '../services/access.js';
import { audit } from '../services/audit.js';
import { consumerDTO } from '../services/serialize.js';

export function consumersRouter() {
  const r = Router();
  r.use('/consumers', requireAuth);

  r.patch(
    '/consumers/:cid',
    asyncHandler(async (req, res) => {
      const { consumer, access } = await loadConsumer(req, String(req.params.cid));
      const input = parse(updateConsumerSchema, req.body);
      Object.assign(consumer, input);
      await consumer.save();
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'consumer.updated',
        resourceType: 'consumer',
        resourceId: consumer._id,
        metadata: input,
      });
      const deps = await ConsumerDependency.find({ consumerId: consumer._id }).lean();
      sendData(res, consumerDTO(consumer.toObject(), deps));
    }),
  );

  r.delete(
    '/consumers/:cid',
    asyncHandler(async (req, res) => {
      const { consumer, access } = await loadConsumer(req, String(req.params.cid));
      await ConsumerDependency.deleteMany({ consumerId: consumer._id });
      await consumer.deleteOne();
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'consumer.deleted',
        resourceType: 'consumer',
        resourceId: consumer._id,
        metadata: { name: consumer.name },
      });
      res.status(204).end();
    }),
  );

  r.post(
    '/consumers/:cid/dependencies',
    asyncHandler(async (req, res) => {
      const { consumer, access } = await loadConsumer(req, String(req.params.cid));
      const input = parse(addDependencySchema, req.body);
      if (
        (await ConsumerDependency.countDocuments({ consumerId: consumer._id })) >=
        LIMITS.maxDependenciesPerConsumer
      )
        throw quotaExceeded('Dependency limit reached.');
      const normalizedKey = normalizeDependencyKey(input.operationKey);
      if (await ConsumerDependency.exists({ consumerId: consumer._id, normalizedKey }))
        throw conflict('This dependency is already registered.');
      const d = await ConsumerDependency.create({
        ...input,
        normalizedKey,
        consumerId: consumer._id,
        projectId: consumer.projectId,
        workspaceId: consumer.workspaceId,
      });
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'dependency.added',
        resourceType: 'consumer',
        resourceId: consumer._id,
        metadata: { operationKey: input.operationKey, evidenceSource: input.evidenceSource },
      });
      const deps = await ConsumerDependency.find({ consumerId: consumer._id })
        .sort({ operationKey: 1 })
        .lean();
      sendData(
        res,
        { dependencyId: d._id.toString(), consumer: consumerDTO(consumer.toObject(), deps) },
        201,
      );
    }),
  );

  r.delete(
    '/consumers/:cid/dependencies/:did',
    asyncHandler(async (req, res) => {
      const { consumer, access } = await loadConsumer(req, String(req.params.cid));
      const d = await ConsumerDependency.findOne({
        _id: oid(String(req.params.did), 'Dependency'),
        consumerId: consumer._id,
      });
      if (!d) throw notFound('Dependency');
      await d.deleteOne();
      await audit(req, {
        workspaceId: access.workspaceId,
        action: 'dependency.removed',
        resourceType: 'consumer',
        resourceId: consumer._id,
        metadata: { operationKey: d.operationKey },
      });
      res.status(204).end();
    }),
  );

  return r;
}
