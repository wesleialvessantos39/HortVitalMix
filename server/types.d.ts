import 'express-serve-static-core';
declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    actor: null | { userId: string; email: string|null; roles: string[] };
  }
}
