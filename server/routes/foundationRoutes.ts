import { Router } from 'express';
import { PLATFORM_PERMISSIONS } from '../../shared/authorization/permissions';
import { updateGlobalConfigurationSchema } from '../../shared/contracts/configuration';
import {
  createRequirePermission,
  getAuthorizationPrincipal,
  type PrincipalResolver,
} from '../authorization/principal';
import { ApplicationError } from '../errors/applicationError';
import { getRequestId } from '../middleware/requestId';
import type { FoundationService } from '../services/foundationService';
import type { GlobalConfigurationService } from '../services/globalConfigurationService';

export function createFoundationRouter(
  foundationService: FoundationService,
  configurationService: GlobalConfigurationService,
  principalResolver: PrincipalResolver,
): Router {
  const router = Router();

  router.get('/health', async (_req, res, next) => {
    try {
      res.status(200).json(await foundationService.health(getRequestId(res)));
    } catch (error) {
      next(error);
    }
  });

  router.get('/ready', async (_req, res, next) => {
    try {
      const payload = await foundationService.readiness(getRequestId(res));
      res.status(payload.status === 'ready' ? 200 : 503).json(payload);
    } catch (error) {
      next(error);
    }
  });

  router.get('/v1/config', async (_req, res, next) => {
    try {
      res.status(200).json(
        await configurationService.getPublicConfiguration(getRequestId(res)),
      );
    } catch (error) {
      next(error);
    }
  });

  router.patch(
    '/v1/admin/configuration',
    createRequirePermission(
      principalResolver,
      PLATFORM_PERMISSIONS.configurationManage,
    ),
    async (req, res, next) => {
      try {
        const parsed = updateGlobalConfigurationSchema.safeParse(req.body);
        if (!parsed.success) {
          throw new ApplicationError(
            422,
            'INVALID_CONFIGURATION',
            'A configuração informada é inválida.',
          );
        }

        const requestId = getRequestId(res);
        const principal = getAuthorizationPrincipal(res);
        const result = await configurationService.updateConfiguration(
          parsed.data,
          principal,
          requestId,
        );
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/v1/environment', async (_req, res, next) => {
    try {
      res.status(200).json(await foundationService.environment(getRequestId(res)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
