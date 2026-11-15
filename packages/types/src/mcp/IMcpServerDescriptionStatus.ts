/**
 * @file IMcpServerDescriptionStatus.ts
 *
 * Whether the MCP server's one-sentence description still matches what the
 * `anonymous` group is granted, shown on `/system/mcp`.
 */

/**
 * The server's self-description beside the anonymous grants it was written for.
 *
 * The description is fixed text in code that clients, the Server Card, and
 * the MCP Registry listing all show, while an admin changes the anonymous
 * grants at runtime. Comparing the tools the sentence was written for with
 * the tools anonymous callers are served now tells the admin when the
 * sentence has gone stale.
 */
export interface IMcpServerDescriptionStatus {
    /** The description clients and registries show. */
    description: string;

    /** The server version reported beside it. */
    version: string;

    /** The anonymous tools the description was written for, sorted by name. */
    describedAnonymousTools: string[];

    /** The tools the `anonymous` group is served now, sorted by name. */
    servedAnonymousTools: string[];

    /** True when the two lists name the same tools. */
    matchesAnonymousGrants: boolean;
}
