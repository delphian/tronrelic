/**
 * @file IMcpGroup.ts
 *
 * One user group as the Tools tab of `/system/mcp` shows it: the group's
 * identity plus its MCP settings.
 */

import type { IMcpGroupPolicy } from './IMcpGroupPolicy.js';

/**
 * A user group an admin can grant MCP tools to.
 *
 * Every group the identity module knows about is listed, because any of them
 * can be given tools. Only members who are also in `mcp-users` can connect, so
 * a grant to another group reaches the members of both.
 */
export interface IMcpGroup {
    /** Group id, the slug membership is keyed on. */
    id: string;

    /** Human-readable label. */
    name: string;

    /** Admin-authored description of the group. */
    description: string;

    /**
     * True for `mcp-users`, the group every MCP user belongs to. Its tools must
     * always pass the MCP safety floor, so it can never allow restricted tools.
     */
    isGateGroup: boolean;

    /** The group's MCP settings, with every setting off when none are stored. */
    policy: IMcpGroupPolicy;
}
