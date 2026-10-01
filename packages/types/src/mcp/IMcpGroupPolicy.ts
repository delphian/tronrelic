/**
 * @file IMcpGroupPolicy.ts
 *
 * The extra protections and permissions an admin sets on one user group for
 * MCP tool access, edited from the Tools tab of `/system/mcp`.
 */

/**
 * Per-group MCP settings.
 *
 * Membership of `mcp-users` is still what lets an account connect at all. This
 * policy shapes what a member gets through the tools granted to one particular
 * group. Every setting starts off, so a group with no stored policy behaves
 * exactly as MCP did before groups had settings.
 *
 * Each setting applies to the tools this group grants. When a caller reaches
 * the same tool through two groups, the IP allowlist decides each route on its
 * own (a route that fails its group's allowlist does not count), and secret
 * scrubbing applies when any route that does count asks for it.
 */
export interface IMcpGroupPolicy {
    /** Id of the user group these settings belong to. */
    groupId: string;

    /**
     * Whether tools that fail the MCP safety floor (`getMcpToolIneligibility`)
     * may be granted to this group: tools that return secret data, write,
     * reach outside the platform, spend money, or declare no capability. Never
     * true for `mcp-users`, because that group is every MCP user. Turning it
     * off withdraws every restricted tool already granted to the group.
     */
    allowRestrictedTools: boolean;

    /**
     * Whether results from tools this group grants are scrubbed before they
     * leave over MCP: the deployment's own secret values and common credential
     * patterns are replaced with a marker.
     */
    scrubSecrets: boolean;

    /**
     * Whether tools this group grants are served only to requests arriving
     * from an address in {@link ipAllowlist}.
     */
    ipAllowlistEnabled: boolean;

    /**
     * Single addresses or CIDR ranges, IPv4 or IPv6, such as `203.0.113.7` or
     * `2001:db8::/32`. Kept when the allowlist is switched off, so switching it
     * back on restores the same list.
     */
    ipAllowlist: string[];

    /** ISO 8601 time of the last change, absent while the group has never been configured. */
    updatedAt?: string;

    /** Better Auth user id of the admin who made the last change. */
    updatedBy?: string;
}
