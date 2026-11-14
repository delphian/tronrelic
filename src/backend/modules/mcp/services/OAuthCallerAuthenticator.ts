/**
 * @fileoverview Identifies callers of the signed-in endpoint (`/mcp`) by their
 * OAuth access token.
 *
 * A missing token is answered with a bearer challenge, which is what makes an
 * MCP client open the sign-in page. The token checks themselves (signature,
 * audience, live grant, scope, `mcp-users` membership) are the resolver's.
 */

import type { Request } from 'express';
import type { ISystemLogService } from '@/types';
import { MCP_TOOLS_SCOPE } from '@/types';
import type { IMcpCallerAuthenticator, McpAuthOutcome } from './IMcpCallerAuthenticator.js';
import type { McpCallerOutcome, McpCallerResolver } from './mcp-caller.resolver.js';
import { readClientName } from './readClientName.js';

/**
 * Authenticator for `/mcp`.
 */
export class OAuthCallerAuthenticator implements IMcpCallerAuthenticator {
    readonly endpoint = 'oauth' as const;

    /**
     * @param callers - Verifies tokens and group membership.
     * @param logger - Module logger, used when a store the check needs is down.
     */
    constructor(
        private readonly callers: McpCallerResolver,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Identify the caller from the `Authorization` header.
     *
     * A storage failure while checking the token says nothing about the
     * token, so it is reported as `unavailable` (a 503) rather than a 401
     * that would make the client discard a token that may be fine.
     *
     * @param req - The incoming request, body not yet parsed.
     * @returns The verified caller, or the challenge or refusal to send.
     */
    async authenticate(req: Request): Promise<McpAuthOutcome> {
        let outcome: McpAuthOutcome;
        const token = readBearerToken(req);
        if (!token) {
            outcome = { kind: 'challenge', status: 401 };
        } else {
            let resolved: McpCallerOutcome | null;
            try {
                resolved = await this.callers.resolve(token, req.ip);
            } catch (error: unknown) {
                this.logger.error({ err: error }, 'Could not check an MCP caller; refusing the request');
                resolved = null;
            }
            if (resolved === null) {
                outcome = { kind: 'unavailable' };
            } else if (resolved.kind === 'invalid-token') {
                outcome = { kind: 'challenge', status: 401, error: 'invalid_token', description: 'The access token is invalid, expired, or was not issued for this endpoint.' };
            } else if (resolved.kind === 'insufficient-scope') {
                outcome = { kind: 'challenge', status: 403, error: 'insufficient_scope', description: `The access token lacks the "${MCP_TOOLS_SCOPE}" scope.` };
            } else if (resolved.kind === 'not-member') {
                outcome = { kind: 'refuse', status: 403, error: 'forbidden', description: 'Your account is not permitted to use the TronRelic MCP endpoint.' };
            } else {
                const clientName = readClientName(req);
                outcome = { kind: 'ok', caller: { ...resolved.caller, ...(clientName ? { clientName } : {}) }, token };
            }
        }
        return outcome;
    }
}

/** Read the bearer token from the `Authorization` header, or null when missing or not a bearer header. */
function readBearerToken(req: Request): string | null {
    const header = req.get('authorization');
    const match = header ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
    return match ? match[1] : null;
}
