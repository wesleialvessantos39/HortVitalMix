import type { Request, Response } from 'express';
import { createApp } from '../server/app';

const { app, pool } = createApp();
let closing = false;

async function closePool(): Promise<void> {
  if (closing) return;
  closing = true;
  try {
    await pool?.end();
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'vercel.pool_shutdown_failed',
      errorName: error instanceof Error ? error.name : 'UnknownError',
    }));
  }
}

process.once('SIGTERM', () => {
  void closePool();
});

export default function handler(req: Request, res: Response): void {
  const rewritten = new URL(req.url, 'http://hortivitalmix.local');
  const path = rewritten.searchParams.get('__path');

  if (path !== null) {
    rewritten.searchParams.delete('__path');
    const query = rewritten.searchParams.toString();
    req.url = `/api/${path}${query ? `?${query}` : ''}`;
  }

  app(req, res);
}
