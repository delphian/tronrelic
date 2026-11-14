/**
 * @fileoverview Identifies callers of `/mcp`, which serves signed-in members
 * and anonymous callers on one URL.
 *
 * Claude and ChatGPT expect one address where anonymous tools work at once and
 * sign-in is asked for only when a tool needs an account ("lazy
 * authentication"). A request with an `Authorization` header is a member and
 * goes through the OAuth authenticator, so a missing, expired, or revoked
 * token still gets the 401 that makes the client refresh or sign in again,
 * rather than being quietly downgraded to anonymous. A request without one is
 * an anonymous caller, counted under its network range like on `/mcp/public`.
 */

import type { Request } from 'express';
import type { IMcpCallerAuthenticator, McpAuthOutcome } from './IMcpCallerAuthenticator.js';

/**
 * Authenticator for `/mcp`, choosing between the member and anonymous paths.
 */
export class MemberOrAnonymousCallerAuthenticator implements IMcpCallerAuthenticator {
    readonly endpoint = 'oauth' as const;

    /**
     * @param member - Verifies bearer tokens; used whenever credentials are sent.
     * @param anonymous - Admits callers who send none.
     */
    constructor(
        private readonly member: IMcpCallerAuthenticator,
        private readonly anonymous: IMcpCallerAuthenticator
    ) {}

    /**
     * Identify the caller: a member when the request carries credentials, an
     * anonymous caller otherwise. An anonymous caller is recorded as arriving
     * through this endpoint, so its accounting rows and logs name `/mcp`.
     *
     * @param req - The incoming request, body not yet parsed.
     * @returns The admitted caller, or the member path's refusal.
     */
    async authenticate(req: Request): Promise<McpAuthOutcome> {
        let outcome: McpAuthOutcome;
        if (req.get('authorization')) {
            outcome = await this.member.authenticate(req);
        } else {
            const admitted = await this.anonymous.authenticate(req);
            outcome = admitted.kind === 'ok' ? { ...admitted, caller: { ...admitted.caller, endpoint: this.endpoint } } : admitted;
        }
        return outcome;
    }
}
