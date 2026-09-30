/**
 * @file IMcpSettings.ts
 *
 * Runtime settings for the MCP endpoint, edited from `/system/mcp`.
 */

/**
 * The operator-controlled state of the MCP endpoint.
 *
 * The MCP module cannot be disabled like a plugin, so `enabled` is its master
 * kill switch. While it is false the endpoint answers every request with
 * `503 Service Unavailable` and lists no tools, and the setting takes effect on
 * the next request without a restart. It starts false on a fresh deployment,
 * so nothing is reachable over MCP until an admin turns it on.
 */
export interface IMcpSettings {
    /** Whether the MCP endpoint serves requests at all. */
    enabled: boolean;

    /** ISO 8601 time of the last change, absent before the first change. */
    updatedAt?: string;

    /** Better Auth user id of the admin who made the last change. */
    updatedBy?: string;
}
