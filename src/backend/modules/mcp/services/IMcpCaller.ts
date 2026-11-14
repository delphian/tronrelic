/**
 * @fileoverview The verified caller of one MCP request, whichever endpoint and
 * credential it arrived with.
 *
 * Everything downstream of authentication (the served tool list, the governor
 * context, the refusal log, the accounting rows) reads this one shape, so a
 * new kind of credential only has to produce it. That is the seam the planned
 * API-key callers will plug into.
 */

import type { IMcpAccessTokenClaims, IToolEndUserPrincipal, McpEndpointKind, McpPrincipalKind } from '@/types';

/**
 * A caller an authenticator has admitted.
 */
export interface IMcpCaller {
    /** The endpoint the request arrived through. */
    endpoint: McpEndpointKind;

    /** What kind of caller this is. */
    principalKind: McpPrincipalKind;

    /**
     * The stable id the caller is counted under: the Better Auth user id for a
     * signed-in caller, or the salted hash of the network range for an
     * anonymous one. Never a raw address.
     */
    principalId: string;

    /**
     * The groups whose grants and limits apply: the account's groups for a
     * signed-in caller, or only `anonymous` for an anonymous one.
     */
    groups: string[];

    /** The live end-user principal, for signed-in callers only. */
    endUser?: IToolEndUserPrincipal;

    /** Claims from the verified access token, for OAuth callers only. */
    claims?: IMcpAccessTokenClaims;

    /** Client IP address as resolved by the trusted proxy chain. */
    ip?: string;

    /**
     * The client's self-reported `User-Agent`, cut to a fixed length. An
     * unverified label for display and grouping, never an identity.
     */
    clientName?: string;
}
