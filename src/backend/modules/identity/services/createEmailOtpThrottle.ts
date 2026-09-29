/**
 * @fileoverview Per-email limits on the email one-time-code (OTP) endpoints.
 *
 * Better Auth rate-limits these endpoints per IP address only. That leaves
 * two attacks open to anyone who can switch between IP addresses, which the
 * prober seen on production on 28–29 Sep 2026 did, rotating between
 * neighbouring addresses:
 *
 * - Guessing a victim's code. Each code allows three wrong guesses and each
 *   IP may request three codes a minute, so every extra IP adds about three
 *   guesses a minute against the same six-digit code space.
 * - Email bombing. Codes can be sent to any address without limit, which
 *   floods the recipient's inbox and spends the site's Resend sending quota.
 *
 * Counting per email address closes both, because the limit then follows the
 * target rather than the caller.
 */

import { createHash } from 'node:crypto';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { ISystemLogService } from '@/types';
import type { IAuthRateLimitRedis } from './IAuthRateLimitRedis.js';
import { consumeRedisWindow } from './consumeRedisWindow.js';

/**
 * Per-email limits. One hour is long enough to make distributed guessing
 * pointless and short enough that a real user who mistypes a few times can
 * try again the same session.
 */
export const EMAIL_OTP_THROTTLE = {
    /** Window both limits are counted over, in seconds. */
    windowSeconds: 3600,

    /**
     * Codes that may be sent to one address per window. Five covers a user
     * who asks for a new code several times while waiting for an email.
     */
    maxSends: 5,

    /**
     * Code checks allowed against one address per window, across every
     * endpoint that checks a code. With three guesses per code this still
     * lets a real user who mistypes use all their sends, while a distributed
     * guesser gets ten tries at a one-in-a-million code instead of thousands.
     */
    maxChecks: 10
} as const;

/** Endpoint that sends a code, counted against `maxSends`. */
const SEND_PATH = '/email-otp/send-verification-otp';

/** Endpoints that check a submitted code, counted together against `maxChecks`. */
const CHECK_PATHS: ReadonlySet<string> = new Set([
    '/sign-in/email-otp',
    '/email-otp/check-verification-otp',
    '/email-otp/verify-email'
]);

/**
 * Longest address this throttle will count, taken from the 254-character
 * limit RFC 5321 places on an email address. Better Auth's body schema for
 * these endpoints is a bare string with no length or format check, and it is
 * applied after this hook runs, so without this bound a caller could hand the
 * throttle a body-sized value and have it copied into a refusal log line. No
 * real address is affected.
 */
const MAX_EMAIL_LENGTH = 254;

/**
 * Apply the per-email limits to one auth request.
 *
 * Kept separate from the Better Auth middleware wrapper so it can be tested
 * with a plain path and body instead of a full Better Auth request context.
 *
 * Requests to other endpoints, and requests without a usable `email` in the
 * body, pass through untouched. The address is trimmed and lowercased first,
 * so `Victim@Example.com` and `victim@example.com` share one budget, and it
 * reaches Redis as a SHA-256 digest rather than as itself. Hashing matters
 * because this hook runs before Better Auth validates the body, and the auth
 * routes skip the Express body parser, so the caller — not the application —
 * would otherwise decide how many bytes each key holds for the length of the
 * window. The digest is always 64 hex characters, one address still maps to
 * one counter, and nothing needs to read the address back out of the key.
 *
 * A Redis failure lets the request through and logs an error, for the same
 * reason given in `createRedisRateLimitStorage`: refusing would stop every
 * sign-in while Redis is down.
 *
 * @param redis - Redis client holding the counters.
 * @param namespace - Deployment Redis namespace (`REDIS_NAMESPACE`), keeping
 *   deployments that share a Redis apart.
 * @param logger - Logger for refusals and Redis failures, so abuse shows up in
 *   the identity module's logs.
 * @param path - Better Auth endpoint path the request is for, which picks the bucket.
 * @param body - Parsed request body, read only for its `email` field.
 * @returns Resolves when the request may proceed.
 * @throws APIError with status 429 when the address has used its budget.
 */
export async function enforceEmailOtpLimit(
    redis: IAuthRateLimitRedis,
    namespace: string,
    logger: ISystemLogService,
    path: string,
    body: unknown
): Promise<void> {
    const isSend = path === SEND_PATH;
    const isCheck = CHECK_PATHS.has(path);
    const rawEmail: unknown = (body as { email?: unknown } | null | undefined)?.email;
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    if ((isSend || isCheck) && email.length > 0 && email.length <= MAX_EMAIL_LENGTH) {
        const bucket = isSend ? 'send' : 'check';
        const max = isSend ? EMAIL_OTP_THROTTLE.maxSends : EMAIL_OTP_THROTTLE.maxChecks;
        const emailHash = createHash('sha256').update(email).digest('hex');
        let outcome: { allowed: boolean; retryAfter: number | null } = { allowed: true, retryAfter: null };
        try {
            outcome = await consumeRedisWindow(
                redis,
                `${namespace}:auth:otp-email:${bucket}:${emailHash}`,
                EMAIL_OTP_THROTTLE.windowSeconds,
                max
            );
        } catch (error) {
            logger.error({ error, path }, 'Per-email OTP throttle check failed; allowing the request');
        }
        if (!outcome.allowed) {
            logger.warn(
                { path, emailDomain: email.split('@').pop(), bucket, retryAfter: outcome.retryAfter },
                'Per-email OTP limit reached; request refused'
            );
            throw new APIError('TOO_MANY_REQUESTS', {
                message: 'Too many sign-in attempts for this email address. Please try again later.'
            });
        }
    }
}

/**
 * Build the Better Auth `hooks.before` middleware that enforces the
 * per-email limits through {@link enforceEmailOtpLimit}.
 *
 * @param redis - Redis client holding the counters.
 * @param namespace - Deployment Redis namespace (`REDIS_NAMESPACE`).
 * @param logger - Logger for refusals and Redis failures.
 * @returns Middleware to pass as the auth instance's `hooks.before`.
 */
export function createEmailOtpThrottle(
    redis: IAuthRateLimitRedis,
    namespace: string,
    logger: ISystemLogService
) {
    return createAuthMiddleware(async (ctx) => {
        await enforceEmailOtpLimit(redis, namespace, logger, ctx.path, ctx.body);
    });
}
