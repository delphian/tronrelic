/**
 * @fileoverview The Better Auth `hooks.before` middleware: the checks every
 * auth request passes before its endpoint runs.
 *
 * Better Auth takes a single before-hook, so the checks that need one share
 * it here, in a fixed order:
 *
 * 1. The sign-up protections (`SignupGuard`): email domain rules and the
 *    enforced site-wide cap, applied to code requests for new addresses.
 * 2. The per-email code limits (`enforceEmailOtpLimit`).
 *
 * The protections run first so a request they refuse does not spend the
 * address's per-email budget. A request refused by either never reaches the
 * endpoint or the audit hook, so each check records its own refusals.
 */

import { createAuthMiddleware } from 'better-auth/api';
import type { ISystemLogService } from '@/types';
import type { IAuthRateLimitRedis } from './IAuthRateLimitRedis.js';
import type { SignupGuard } from './SignupGuard.js';
import { enforceEmailOtpLimit } from './enforceEmailOtpLimit.js';

/**
 * Build the auth instance's `hooks.before` middleware.
 *
 * @param signupGuard - Applies the sign-up protections to code requests.
 * @param redis - Redis client holding the per-email counters.
 * @param namespace - Deployment Redis namespace (`REDIS_NAMESPACE`).
 * @param logger - Logger for per-email refusals and Redis failures.
 * @returns Middleware to pass as the auth instance's `hooks.before`.
 */
export function createAuthBeforeHook(
    signupGuard: Pick<SignupGuard, 'checkCodeRequest'>,
    redis: IAuthRateLimitRedis,
    namespace: string,
    logger: ISystemLogService
) {
    return createAuthMiddleware(async (ctx) => {
        await signupGuard.checkCodeRequest({ path: ctx.path, body: ctx.body, headers: ctx.headers ?? null });
        await enforceEmailOtpLimit(redis, namespace, logger, ctx.path, ctx.body);
    });
}
