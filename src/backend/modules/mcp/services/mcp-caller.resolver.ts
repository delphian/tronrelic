/**
 * @fileoverview Turns a bearer token into a verified MCP caller, or a reason
 * to refuse the request.
 *
 * A valid signature is not enough on its own. An access token lives for
 * minutes and cannot be recalled, so on every request this resolver also
 * checks that the account still exists and is still a member of the MCP
 * group. Those two lookups are cached per user for a short time, which bounds
 * how long a removed user keeps access to the cache window rather than the
 * token's lifetime.
 *
 * An accepted request also tells the identity module the app was used, which
 * is where the "last used" time on the connected-apps lists comes from.
 */

import type { IConnectedAppsService, IMcpAccessTokenVerifier, ISystemLogService, IToolEndUserPrincipal } from '@/types';
import { MCP_TOOLS_SCOPE, MCP_USERS_GROUP_ID } from '@/types';
import type { EndUserResolver } from '../../ai-tools/index.js';
import type { IMcpCaller } from './mcp-server.factory.js';

/**
 * How long a resolved principal is reused before the account and its groups
 * are read again. Removing a user from the group takes effect within this
 * window.
 */
const PRINCIPAL_CACHE_TTL_MS = 30_000;

/** Upper bound on cached principals, so a flood of distinct users cannot grow memory without limit. */
const PRINCIPAL_CACHE_MAX = 5_000;

/**
 * The outcome of checking a request's credentials. Each refusal maps to one
 * HTTP answer in the controller.
 */
export type McpCallerOutcome =
    | { kind: 'ok'; caller: IMcpCaller }
    | { kind: 'invalid-token' }
    | { kind: 'insufficient-scope' }
    | { kind: 'not-member' };

/** A cached principal and the time it was read. */
interface ICachedPrincipal {
    principal: IToolEndUserPrincipal | null;
    readAt: number;
}

/**
 * Checks bearer tokens and group membership for the MCP endpoint.
 */
export class McpCallerResolver {
    private readonly principals = new Map<string, ICachedPrincipal>();

    /**
     * @param verifier - The identity module's token verifier; it owns the
     *   signing keys and the check that the grant has not been revoked.
     * @param resolveEndUser - Reads the account's current groups, email, and
     *   primary wallet.
     * @param usage - The identity module's grant store, told about each
     *   accepted request so it can record when the app was last used.
     * @param logger - Module logger, used to note refused callers.
     */
    constructor(
        private readonly verifier: IMcpAccessTokenVerifier,
        private readonly resolveEndUser: EndUserResolver,
        private readonly usage: Pick<IConnectedAppsService, 'recordUse'>,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Check a bearer token and decide whether its holder may use the endpoint.
     *
     * @param token - The raw bearer token.
     * @param ip - Client IP address, kept for the audit record.
     * @returns The verified caller, or the reason the request is refused.
     */
    async resolve(token: string, ip: string | undefined): Promise<McpCallerOutcome> {
        let outcome: McpCallerOutcome;
        const claims = await this.verifier.verify(token);
        if (!claims) {
            outcome = { kind: 'invalid-token' };
        } else if (!claims.scopes.includes(MCP_TOOLS_SCOPE)) {
            outcome = { kind: 'insufficient-scope' };
        } else {
            const principal = await this.principalFor(claims.userId);
            if (!principal) {
                // The account was deleted after the token was issued.
                outcome = { kind: 'invalid-token' };
            } else if (!(principal.groups ?? []).includes(MCP_USERS_GROUP_ID)) {
                this.logger.info({ userId: claims.userId, clientId: claims.clientId }, 'MCP request refused: user is not in the MCP group');
                outcome = { kind: 'not-member' };
            } else {
                outcome = { kind: 'ok', caller: { claims, endUser: principal, ...(ip ? { ip } : {}) } };
                if (claims.clientId) {
                    // Not awaited: the write is throttled, never rejects, and
                    // must not add latency to the request.
                    void this.usage.recordUse(claims.userId, claims.clientId);
                }
            }
        }
        return outcome;
    }

    /**
     * Return the user's principal from the cache, reading it again once the
     * cached copy is older than the cache window.
     *
     * @param userId - Better Auth user id from the verified token.
     * @returns The live principal, or null when the account no longer exists.
     */
    private async principalFor(userId: string): Promise<IToolEndUserPrincipal | null> {
        const now = Date.now();
        const cached = this.principals.get(userId);
        let principal: IToolEndUserPrincipal | null;
        if (cached && now - cached.readAt < PRINCIPAL_CACHE_TTL_MS) {
            principal = cached.principal;
        } else {
            principal = await this.resolveEndUser(userId);
            if (this.principals.size >= PRINCIPAL_CACHE_MAX) {
                this.principals.clear();
            }
            this.principals.set(userId, { principal, readAt: now });
        }
        return principal;
    }
}
