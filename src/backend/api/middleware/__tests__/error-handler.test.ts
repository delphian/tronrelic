/**
 * Tests for the application error handler.
 *
 * Pins the status each kind of error maps to, and the rule that a 500 never
 * echoes the underlying message: once the handler was moved to run after the
 * routers, internal errors from those routes started reaching it, and their
 * messages can carry database or library internals.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import { z } from 'zod';

vi.mock('../../../lib/logger.js', () => ({
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

const { errorHandler } = await import('../error-handler.js');
const { TronRelicError } = await import('../../../lib/errors.js');
const { CorsOriginRejectedError } = await import('../../../config/CorsOriginRejectedError.js');
const { logger } = await import('../../../lib/logger.js');

/**
 * Run the handler on one error and capture the response.
 *
 * @param error - The error passed to `next()`.
 * @returns The status code and JSON body the handler sent.
 */
function run(error: unknown): { status: number; body: Record<string, unknown> } {
    const captured: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
    const res = {
        status(code: number) {
            captured.status = code;
            return this;
        },
        json(body: Record<string, unknown>) {
            captured.body = body;
            return this;
        }
    } as unknown as Response;
    errorHandler(error, { id: 'req-1' } as unknown as Request, res, vi.fn());
    return captured;
}

describe('errorHandler', () => {
    it('returns a fixed message for an unexpected error, never its internal text', () => {
        const result = run(new Error('MongoServerError: connection to 10.0.0.5:27017 closed'));

        expect(result.status).toBe(500);
        expect(result.body.error).toBe('Internal server error');
    });

    it('maps a ZodError to 400', () => {
        const parsed = z.object({ n: z.number() }).safeParse({ n: 'x' });

        const result = run(parsed.success ? null : parsed.error);

        expect(result.status).toBe(400);
        expect(result.body.code).toBe('VALIDATION_ERROR');
    });

    it('keeps the message of an application TronRelicError', () => {
        const result = run(new TronRelicError('Bad address', 'INVALID_ADDRESS'));

        expect(result.status).toBe(400);
        expect(result.body).toMatchObject({ error: 'Bad address', code: 'INVALID_ADDRESS' });
    });

    it('honours the 4xx status body-parser attaches, and shows its message only when exposed', () => {
        const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, expose: true });
        const hidden = Object.assign(new Error('internal parser detail'), { statusCode: 400 });

        expect(run(tooLarge)).toMatchObject({ status: 413, body: { error: 'request entity too large' } });
        expect(run(hidden)).toMatchObject({ status: 400, body: { error: 'Invalid request' } });
    });

    it('treats a 5xx status on the error as a server failure', () => {
        const result = run(Object.assign(new Error('upstream detail'), { status: 502 }));

        expect(result.status).toBe(500);
        expect(result.body.error).toBe('Internal server error');
    });

    it('answers a CORS rejection with 403 and logs a warning carrying the origin', () => {
        vi.mocked(logger.error).mockClear();
        vi.mocked(logger.warn).mockClear();

        const result = run(new CorsOriginRejectedError('https://not-allowed.example'));

        expect(result).toMatchObject({ status: 403, body: { error: 'CORS policy: Origin not allowed' } });
        expect(logger.error).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ error: expect.objectContaining({ origin: 'https://not-allowed.example' }) }),
            'Handled error'
        );
    });
});
