/**
 * @file IMcpToolExposure.ts
 *
 * One row of the MCP tool list on `/system/mcp`: a registered AI tool and the
 * user groups it is approved for.
 */

import type { IAiToolCapability } from '../ai-tools/IAiToolCapability.js';
import type { IMcpToolGrant } from './IMcpToolGrant.js';

/**
 * A registered AI tool as the MCP admin page shows it.
 *
 * Every tool starts hidden from MCP. An admin approves it for one group at a
 * time, and each approval is a separate {@link IMcpToolGrant}. A member of
 * `mcp-users` sees the tool when one of their groups holds a grant that is
 * currently served.
 */
export interface IMcpToolExposure {
    /** Registered tool name. */
    name: string;

    /** The description the model sees. */
    description: string;

    /** Module or plugin id that registered the tool. */
    provider: string;

    /** Whether the tool is switched on in the AI tool registry. A disabled tool is never served. */
    enabledInRegistry: boolean;

    /** The tool's declared capability, or undefined when it declares none. */
    capability?: IAiToolCapability;

    /**
     * Why the tool is restricted, or null when it passes the MCP safety floor.
     * Comes from `getMcpToolIneligibility`, the same rule the governor applies.
     * A restricted tool can be granted only to a group whose policy allows
     * restricted tools, and never to `mcp-users`.
     */
    restrictedReason: string | null;

    /** The tool's approvals, one per group, sorted by group id. */
    grants: IMcpToolGrant[];

    /** Whether any grant currently serves the tool. */
    served: boolean;

    /** Whether any grant is stale because the tool's capability changed after it was approved. */
    stale: boolean;
}
