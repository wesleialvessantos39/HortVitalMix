import type { Request, RequestHandler, Response } from 'express';
import type { PlatformPermission } from '../../shared/authorization/permissions';
import { ApplicationError } from '../errors/applicationError';

export interface AuthorizationPrincipal {
  actorId: string;
  permissions: ReadonlySet<PlatformPermission>;
}

export type PrincipalResolver =
  (request: Request) => AuthorizationPrincipal | null | Promise<AuthorizationPrincipal | null>;

export const anonymousPrincipalResolver: PrincipalResolver = () => null;

const PRINCIPAL_LOCAL_KEY = 'authorizationPrincipal';

export function createRequirePermission(
  resolver: PrincipalResolver,
  permission: PlatformPermission,
): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(resolver(request))
      .then((principal) => {
        if (!principal || !principal.permissions.has(permission)) {
          next(new ApplicationError(403, 'FORBIDDEN', 'Você não possui permissão para esta operação.'));
          return;
        }

        response.locals[PRINCIPAL_LOCAL_KEY] = principal;
        next();
      })
      .catch(next);
  };
}

export function getAuthorizationPrincipal(response: Response): AuthorizationPrincipal {
  const principal = response.locals[PRINCIPAL_LOCAL_KEY] as AuthorizationPrincipal | undefined;
  if (!principal) {
    throw new ApplicationError(403, 'FORBIDDEN', 'Você não possui permissão para esta operação.');
  }
  return principal;
}
