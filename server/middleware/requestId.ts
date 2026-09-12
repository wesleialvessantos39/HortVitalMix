import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const received = req.header(REQUEST_ID_HEADER);
  const requestId = received && UUID_PATTERN.test(received) ? received : randomUUID();
  res.locals.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

export function getRequestId(res: Response): string {
  const value = res.locals.requestId;
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : randomUUID();
}
