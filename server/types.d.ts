export {};

declare global {
  namespace Express {
    interface Request {
      actor: {
        userId: string;
        email: string | null;
        roles: string[];
        personId: string | null;
      } | null;
    }
  }
}
