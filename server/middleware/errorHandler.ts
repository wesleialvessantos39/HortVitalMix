import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { getRequestId } from './requestId';

interface ErrorWithType extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
  body?: unknown;
}

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({
    error: { code, message },
    requestId: getRequestId(res),
  });
}

export const apiNotFoundHandler: RequestHandler = (_req, res) => {
  sendError(res, 404, 'API_NOT_FOUND', 'O recurso de API solicitado não existe.');
};

export const errorHandler: ErrorRequestHandler = (error: ErrorWithType, _req, res, _next) => {
  const isTooLarge = error.type === 'entity.too.large' || error.status === 413 || error.statusCode === 413;
  if (isTooLarge) {
    sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'O corpo da requisição excede o limite permitido.');
    return;
  }

  if (error instanceof SyntaxError && 'body' in error) {
    sendError(res, 400, 'INVALID_JSON', 'O corpo JSON da requisição é inválido.');
    return;
  }

  console.error(JSON.stringify({
    level: 'error',
    code: 'UNHANDLED_ERROR',
    requestId: getRequestId(res),
    errorName: error.name || 'Error',
  }));

  sendError(res, 500, 'INTERNAL_ERROR', 'Não foi possível concluir a operação.');
};
