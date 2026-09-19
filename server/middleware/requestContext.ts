import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && /^[0-9a-f-]{36}$/i.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
