import type { NextFunction, Request, Response } from 'express';
export function sameOrigin(req: Request, res: Response, next: NextFunction): void {
  if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const host = req.get('host');
    const parsed = new URL(origin);
    const allowedPreview = process.env.VERCEL_ENV === 'preview' && /\.vercel\.app$/i.test(parsed.hostname);
    if (parsed.host === host || allowedPreview) return next();
  } catch { /* fail closed */ }
  res.status(403).json({error:'ORIGIN_NOT_ALLOWED',requestId:req.requestId});
}
