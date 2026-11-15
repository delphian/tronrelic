/**
 * @file buildMcpServerDescriptionStatus.ts
 *
 * The rule that decides whether the MCP server's description still matches
 * what anonymous callers are served, shared by the backend (the status read
 * and the log written when an anonymous grant changes) and the admin page
 * (which recomputes it after each toggle), so the two can never disagree.
 */

import type { IMcpServerDescriptionStatus } from './IMcpServerDescriptionStatus.js';
import type { IMcpToolExposure } from './IMcpToolExposure.js';
import { MCP_ANONYMOUS_GROUP_ID } from './MCP_ANONYMOUS_GROUP_ID.js';

/**
 * Compare the anonymous tools the server's description was written for with
 * the tools the `anonymous` group is served now.
 *
 * The description is a fixed sentence in code that AI clients, the Server
 * Card, and the MCP Registry listing show, while an admin changes the
 * anonymous grants at runtime. A tool counts as served when its `anonymous`
 * grant is served, so a stale grant or a switched-off group reads as
 * withdrawn, the same as a caller sees it.
 *
 * @param description - The sentence clients and registries show.
 * @param version - The server version reported beside it.
 * @param describedAnonymousTools - The anonymous tools the sentence was written for.
 * @param tools - Every registered tool with its grants.
 * @returns The description beside both tool lists, sorted, and whether they match.
 */
export function buildMcpServerDescriptionStatus(
    description: string,
    version: string,
    describedAnonymousTools: readonly string[],
    tools: readonly Pick<IMcpToolExposure, 'name' | 'grants'>[]
): IMcpServerDescriptionStatus {
    const described = [...new Set(describedAnonymousTools)].sort();
    const served = tools
        .filter(tool => tool.grants.some(grant => grant.groupId === MCP_ANONYMOUS_GROUP_ID && grant.served))
        .map(tool => tool.name)
        .sort();
    return {
        description,
        version,
        describedAnonymousTools: described,
        servedAnonymousTools: served,
        matchesAnonymousGrants: described.length === served.length && described.every((name, index) => name === served[index])
    };
}
