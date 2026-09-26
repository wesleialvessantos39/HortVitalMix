export {};

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      clientIpHash: string;
      adminActor?: import("./middleware/adminSession.ts").AdminActorContext;
      actor: {
        userId: string;
        email: string | null;
        roles: string[];
        personId: string | null;
        fullName: string | null;
      } | null;
    }
  }
}
