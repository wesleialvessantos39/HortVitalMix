import type { RequestHandler } from 'express';
import type { RuntimeConfig } from '../config/runtime';

export function createEnvironmentSecurityMiddleware(runtime: RuntimeConfig): RequestHandler {
  return (_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (!runtime.indexingAllowed) {
      response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }

    if (runtime.tlsRequired) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      );
    }

    next();
  };
}
