import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { logger } from '../../lib/logger.js';
import { TronRelicError } from '../../lib/errors.js';

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = StatusCodes.INTERNAL_SERVER_ERROR;
  let code = 'INTERNAL_ERROR';
  let message = 'Internal server error';
  let details: unknown;

  if (error instanceof TronRelicError) {
    status = StatusCodes.BAD_REQUEST;
    code = error.code;
    message = error.message;
    details = error.details;
  } else if (error instanceof ZodError) {
    status = StatusCodes.BAD_REQUEST;
    code = 'VALIDATION_ERROR';
    message = 'Invalid request payload';
    details = error.flatten();
  } else if (error instanceof Error) {
    message = error.message;
  }

  if (status >= 500) {
    logger.error({ error, requestId: req.id }, 'Unhandled error');
  } else {
    logger.warn({ error, requestId: req.id }, 'Handled error');
  }

  res.status(status).json({ success: false, error: message, code, details });
}
