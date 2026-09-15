import {randomUUID} from 'node:crypto';
import express, {type NextFunction, type Request, type Response} from 'express';
import {foundationRouter} from './routes/foundationRoutes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const incoming = req.header('x-request-id');
    const value =
      incoming && /^[a-zA-Z0-9._:-]{8,128}$/.test(incoming) ? incoming : randomUUID();

    res.locals.requestId = value;
    res.setHeader('x-request-id', value);
    next();
  });

  app.use(express.json({limit: '256kb'}));
  app.use('/api', foundationRouter);

  app.use('/api', (_req, res) =>
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Rota não encontrada.',
        requestId: res.locals.requestId,
      },
    }),
  );

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof SyntaxError) {
      return res.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'JSON inválido.',
          requestId: res.locals.requestId,
        },
      });
    }

    if (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      error.type === 'entity.too.large'
    ) {
      return res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'O corpo excede 256 KiB.',
          requestId: res.locals.requestId,
        },
      });
    }

    return res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Erro interno inesperado.',
        requestId: res.locals.requestId,
      },
    });
  });

  return app;
}

export default createApp();
