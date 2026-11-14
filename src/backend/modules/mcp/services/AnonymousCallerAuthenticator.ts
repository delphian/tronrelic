/**
 * @fileoverview Identifies callers of the public endpoint (`/mcp/public`),
 * who do not sign in.
 *
 * Every request is admitted as an anonymous caller in the virtual `anonymous`
 * group, counted under the salted hash of its network range. What the caller
 * may then do is decided by the tools granted to that group and its limits,
 * not here.
 *
 * A request carrying an `Authorization` header is refused rather than
 * silently served as anonymous, because a client sending credentials expects
 * them to count and should be told to use `/mcp`. When API keys exist, a key
 * authenticator will sit in front of this one and take such requests first.
 */

import type { Request } from 'express';
import { MCP_ANONYMOUS_GROUP_ID } from '@/types';
import type { AnonymousCallerKeyer } from './AnonymousCallerKeyer.js';
import type { IMcpCallerAuthenticator, McpAuthOutcome } from './IMcpCallerAuthenticator.js';
import { readClientName } from './readClientName.js';

/**
 * Authenticator for `/mcp/public`.
 */
export class AnonymousCallerAuthenticator implements IMcpCallerAuthenticator {
    readonly endpoint = 'public' as const;

    /**
     * @param keyer - Turns the request address into the caller's id.
     * @param signedInUrl - The signed-in endpoint's URL, named in the refusal
     *   sent to a client that brought credentials.
     */
    constructor(
        private readonly keyer: AnonymousCallerKeyer,
        private readonly signedInUrl: string
    ) {}

    /**
     * Admit the request as an anonymous caller, or refuse it when it carries
     * credentials.
     *
     * @param req - The incoming request, body not yet parsed.
     * @returns The anonymous caller, or a refusal.
     */
    async authenticate(req: Request): Promise<McpAuthOutcome> {
        let outcome: McpAuthOutcome;
        if (req.get('authorization')) {
            outcome = {
                kind: 'refuse',
                status: 400,
                error: 'invalid_request',
                description: `This endpoint takes no credentials. Signed-in members connect to ${this.signedInUrl}.`
            };
        } else {
            const clientName = readClientName(req);
            outcome = {
                kind: 'ok',
                caller: {
                    endpoint: 'public',
                    principalKind: 'anonymous',
                    principalId: this.keyer.keyFor(req.ip),
                    groups: [MCP_ANONYMOUS_GROUP_ID],
                    ...(req.ip ? { ip: req.ip } : {}),
                    ...(clientName ? { clientName } : {})
                }
            };
        }
        return outcome;
    }
}
