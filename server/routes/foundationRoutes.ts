import { Router } from 'express';
import type { FoundationService } from '../services/foundationService';
import { getRequestId } from '../middleware/requestId';

export function createFoundationRouter(service: FoundationService): Router {
  const router = Router();

  router.get('/health', async (_req, res, next) => {
    try {
      res.status(200).json(await service.health(getRequestId(res)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/ready', async (_req, res, next) => {
    try {
      const payload = await service.readiness(getRequestId(res));
      res.status(payload.status === 'ready' ? 200 : 503).json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/config', (_req, res) => {
    res.status(200).json(service.publicConfig(getRequestId(res)));
  });

  router.get('/v1/environment', (_req, res) => {
    res.status(200).json(service.environment(getRequestId(res)));
  });

  return router;
}
