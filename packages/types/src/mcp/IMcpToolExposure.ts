/**
 * @file IMcpToolExposure.ts
 *
 * One row of the MCP tool list on `/system/mcp`: a registered AI tool and
 * whether members of the MCP group can see and call it.
 */

import type { IAiToolCapability } from '../ai-tools/IAiToolCapability.js';

/**
 * A registered AI tool as the MCP admin page shows it.
 *
 * Every tool starts hidden from MCP. An admin approves each one explicitly,
 * and the approval is stored together with a fingerprint of the tool's
 * capability declaration. When a tool's declaration later changes, `stale`
 * turns true and the tool drops back to hidden until an admin approves it
 * again, so a plugin update cannot silently widen what MCP users reach.
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
     * Why the tool can never be exposed over MCP, or null when it may be.
     * Comes from `getMcpToolIneligibility`, the same rule the governor applies.
     */
    ineligibleReason: string | null;

    /** Whether an admin approved the tool for MCP (it may still be stale). */
    approved: boolean;

    /** True when the tool's capability changed after it was approved; a stale tool is not served. */
    stale: boolean;

    /** Whether MCP group members can currently see and call the tool. */
    served: boolean;

    /** ISO 8601 time the tool was approved, when approved. */
    approvedAt?: string;

    /** Better Auth user id of the admin who approved it, when approved. */
    approvedBy?: string;
}
