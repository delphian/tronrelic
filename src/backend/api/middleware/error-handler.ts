/**
 * @fileoverview The application's single Express error handler.
 *
 * Registered last in bootstrap (see `index.ts`), after every router, so it sees
 * errors from the /api router, module routers, and plugin routers as well as
 * from app-level middleware such as CORS and the body parsers.
 */
import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { logger } from '../../lib/logger.js';
import { TronRelicError } from '../../lib/errors.js';

/**
 * Read the HTTP status a client-side error already carries.
 *
 * body-parser and other `http-errors`-style middleware attach `status` (or
 * `statusCode`) to the errors they raise, such as 413 for an oversized body
 * and 400 for malformed JSON. Honouring that keeps a bad request from being
 * reported and logged as a server failure.
 *
 * @param error - Whatever was passed to `next()`.
 * @returns The 4xx status on the error, or null when it carries none.
 */
function clientErrorStatus(error: unknown): number | null {
    const candidate = (error as { status?: unknown; statusCode?: unknown } | null)?.status
        ?? (error as { statusCode?: unknown } | null)?.statusCode;
    const status = typeof candidate === 'number' && candidate >= 400 && candidate < 500 ? candidate : null;
    return status;
}

/**
 * Turn an error raised anywhere in the request pipeline into a JSON response.
 *
 * Known client errors (`TronRelicError`, `ZodError`, and errors carrying a 4xx
 * status) answer with that status and a message safe to show. Everything else
 * is a 500 whose body is always the fixed text "Internal server error". The
 * real message is logged but never sent, because it can be a database
 * driver's or a library's internal text, and a public API must not hand that
 * to whoever caused it.
 *
 * @param error - Whatever was passed to `next()`.
 * @param req - The failed request; its id ties the log line to the response.
 * @param res - Response to send the JSON error on.
 * @param _next - Required so Express recognises this as error middleware.
 */
export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
    let status: number = StatusCodes.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details: unknown;
    const clientStatus = clientErrorStatus(error);

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
    } else if (clientStatus !== null) {
        status = clientStatus;
        code = 'REQUEST_ERROR';
        // `expose` is the http-errors convention for "this message is safe to
        // show the client"; body-parser sets it on its 4xx errors.
        const exposable = (error as { expose?: unknown }).expose === true && error instanceof Error;
        message = exposable ? (error as Error).message : 'Invalid request';
    }

    if (status >= 500) {
        logger.error({ error, requestId: req.id }, 'Unhandled error');
    } else {
        logger.warn({ error, requestId: req.id }, 'Handled error');
    }

    res.status(status).json({ success: false, error: message, code, details });
}
