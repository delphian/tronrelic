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
 * call?" and revoke the right grant. Absent on the admin query, scheduled, and
 * programmatic paths, which have no external client.
 */
export interface IToolInvocationOrigin {
    /** OAuth client id of the connected app (for example, a client metadata document URL). */
    clientId?: string;

    /** Identifier of the credential used, such as the access token's `jti` claim. Never the token itself. */
    credentialId?: string;

    /** Client IP address as resolved by the trusted proxy chain. */
    ip?: string;
}
