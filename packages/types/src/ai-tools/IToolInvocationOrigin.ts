/**
 * @file IToolInvocationOrigin.ts
 *
 * Where a governed tool invocation arrived from, for calls that enter over an
 * external protocol such as MCP.
 */

/**
 * Where an invocation arrived from, for calls that enter over an external
 * protocol such as MCP. The audit record copies it so an operator can answer
 * "which connected app, using which credential, from which address, made this
 * call, and which group was it charged to?" and revoke the right grant or
 * tighten the right group. Absent on the admin query, scheduled, and
 * programmatic paths, which have no external client.
 *
 * The fields are plain strings rather than MCP types so the governor stays
 * independent of any one protocol. Every field is set by the entry point from
 * verified credentials, never from model input.
 */
export interface IToolInvocationOrigin {
    /** OAuth client id of the connected app (for example, a client metadata document URL). */
    clientId?: string;

    /**
     * The client's self-reported name and version from the protocol handshake,
     * such as `claude-ai 0.1.0`. The caller chooses it, so treat it as an
     * unverified label for display and grouping, never as an identity.
     */
    clientName?: string;

    /** Identifier of the credential used, such as the access token's `jti` claim. Never the token itself. */
    credentialId?: string;

    /** Client IP address as resolved by the trusted proxy chain. */
    ip?: string;

    /** Which endpoint the call arrived through, such as `oauth` or `public` for MCP. */
    endpoint?: string;

    /** The kind of caller, such as `user` or `anonymous` for MCP. */
    principalKind?: string;

    /**
     * The stable id the entry point counts this caller under: a user id, or
     * for an anonymous caller the salted hash of its network range.
     */
    principalId?: string;

    /** The user group the call was charged to, whose limits applied. */
    chargedGroupId?: string;
}
