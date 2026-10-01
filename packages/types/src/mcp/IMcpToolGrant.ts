/**
 * @file IMcpToolGrant.ts
 *
 * One admin approval of one AI tool for one user group's MCP access.
 */

/**
 * A tool approved for a group.
 *
 * The approval is stored with a fingerprint of the tool's capability at that
 * moment. When the tool's declaration later changes, `stale` turns true and the
 * grant stops serving until an admin approves it again, so a plugin update
 * cannot silently widen what the group reaches.
 */
export interface IMcpToolGrant {
    /** The group the tool is approved for. */
    groupId: string;

    /** ISO 8601 time of the approval. */
    approvedAt: string;

    /** Better Auth user id of the admin who approved it. */
    approvedBy?: string;

    /** True when the tool's capability changed after this approval; a stale grant is not served. */
    stale: boolean;

    /**
     * Whether this grant currently serves the tool to the group's members. It
     * does not while the grant is stale, while the tool is switched off in the
     * AI tool registry, or while the tool is restricted and the group does not
     * allow restricted tools.
     */
    served: boolean;
}
