/**
 * @fileoverview Refuses OAuth consent from users outside the MCP group.
 *
 * Better Auth's `/oauth2/consent` endpoint only requires a session. Without
 * this gate a signed-in user outside `mcp-users` could post `accept: true`
 * directly, skipping the consent page that hides the Allow button from them,
 * and Better Auth would store a consent row and issue an authorization code.
 * Token issuance is still refused later by `customAccessTokenClaims`, but the
 * stored consent would show on `/system/mcp` as a connected app and count as a
 * live grant. Refusing here means a grant can only exist for a member.
 */

import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import type { BetterAuthPlugin } from 'better-auth';
import type { ISystemLogService } from '@/types';
import { MCP_USERS_GROUP_ID } from '@/types';
import { userGroups } from './userGroups.js';

/** Better Auth endpoint that records a user's consent decision. */
const CONSENT_PATH = '/oauth2/consent';

/**
 * Refuse a consent approval from a user outside the MCP group.
 *
 * Kept separate from the Better Auth plugin wrapper so it can be tested with
 * a plain body and user instead of a full Better Auth request context.
 *
 * Only an approval is refused. A denial still passes, so the consent page's
 * Deny button keeps sending the app back with `access_denied` as the OAuth
 * specification expects. A request with no session also passes, because the
 * endpoint's own session middleware answers it with 401.
 *
 * @param body - Parsed consent request body, read only for its `accept` flag.
 * @param user - The signed-in user, or null when the request has no session.
 * @param logger - Logger for refusals, so direct attempts show up in the identity module's logs.
 * @returns Resolves when the request may proceed.
 * @throws APIError with status 403 and `access_denied` when a non-member approves.
 */
export function enforceMcpConsentMembership(
    body: unknown,
    user: (Record<string, unknown> & { id?: string }) | null | undefined,
    logger: ISystemLogService
): void {
    const accepted = (body as { accept?: unknown } | null | undefined)?.accept === true;
    if (accepted && user && !userGroups(user).includes(MCP_USERS_GROUP_ID)) {
        logger.info({ userId: user.id }, 'OAuth consent refused: user is not in the MCP group');
        throw new APIError('FORBIDDEN', {
            error: 'access_denied',
            error_description: 'This account is not permitted to connect apps to TronRelic.'
        });
    }
}

/**
 * Build the Better Auth plugin that applies {@link enforceMcpConsentMembership}
 * to the consent endpoint.
 *
 * It is a plugin rather than part of the instance's `hooks.before`, because a
 * plugin hook can match one path and sit beside `oauthProvider`, whose
 * endpoint it guards. The session is read with `getSessionFromCtx`, which
 * caches it on the request so the endpoint does not look it up a second time.
 *
 * @param logger - Logger for refusals.
 * @returns Plugin to add after `oauthProvider` in the auth instance's plugin list.
 */
export function createMcpConsentGate(logger: ISystemLogService) {
    return {
        id: 'mcp-consent-gate',
        hooks: {
            before: [
                {
                    /**
                     * Select only the consent endpoint, so every other auth
                     * request skips the session lookup.
                     *
                     * @param ctx - Better Auth's hook context; only the path is read.
                     * @returns True for requests to `/oauth2/consent`.
                     */
                    matcher: (ctx) => ctx.path === CONSENT_PATH,
                    /**
                     * Look up the caller's session and refuse the request
                     * when a non-member is approving.
                     *
                     * @param ctx - Better Auth's middleware context, carrying
                     *   the request headers the session is read from and the
                     *   parsed body.
                     */
                    handler: createAuthMiddleware(async (ctx) => {
                        const session = await getSessionFromCtx(ctx);
                        enforceMcpConsentMembership(ctx.body, session?.user, logger);
                    })
                }
            ]
        }
    } satisfies BetterAuthPlugin;
}
