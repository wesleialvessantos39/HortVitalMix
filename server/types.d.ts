export {};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      clientIpHash: string;
      adminActor?: import("./services/ConfigurationService.ts").ActorContext;
      actor: {
        userId: string;
        email: string | null;
        roles: string[];
        personId: string | null;
      } | null;
    }
  }
}
