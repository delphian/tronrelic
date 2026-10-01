/**
 * @file getMcpToolIneligibility.ts
 *
 * The safety floor that decides whether an AI tool may be offered to an MCP
 * user's own AI client without an explicit opt-in for restricted tools.
 */

import type { IAiToolCapability } from './IAiToolCapability.js';

/**
 * Explain why a tool is restricted over MCP, or return null when it passes the
 * floor.
 *
 * An admin chooses which tools MCP users see, but a single misclick must not
 * hand every MCP user a log reader or a site-wide broadcast. This check is the
 * floor under that choice. A tool that fails it can never be granted to
 * `mcp-users`, and can be granted to another user group only after an admin
 * switches on "allow restricted tools" for that group on `/system/mcp`. Both
 * the MCP module (when it lists, grants, and serves tools) and the governor's
 * policy engine (on every `mcp` call) apply it, so the two can never disagree.
 *
 * A tool qualifies only when it declares a capability and that capability is
 * read-only, reversible, spends no money, and is not `secret`. The MCP client
 * brings its own ways to send data out (web fetch, email), so the platform has
 * to assume the exfiltration leg of the lethal trifecta is always present on
 * this path. Excluding `secret` readers removes the private-data leg instead.
 * An unclassified tool is refused rather than given the read/internal default,
 * because nobody has stated what it does.
 *
 * @param capability - The tool's declared capability, or undefined when the
 *   tool shipped without one.
 * @returns A sentence naming the rule the tool breaks, for the admin page and
 *   the audit record, or null when the tool passes the floor.
 */
export function getMcpToolIneligibility(capability: IAiToolCapability | undefined): string | null {
    let reason: string | null = null;
    if (!capability) {
        reason = 'The tool declares no capability, so what it does is unknown.';
    } else if (capability.sideEffect !== 'read') {
        reason = `The tool's side effect is "${capability.sideEffect}"; only read-only tools can be offered over MCP.`;
    } else if (capability.sensitivity === 'secret') {
        reason = 'The tool returns secret data, and an MCP client can always send data off-site.';
    } else if (capability.spendsMoney === true) {
        reason = 'The tool spends money on each call.';
    } else if (capability.reversible !== true) {
        reason = 'The tool declares an irreversible effect.';
    }
    return reason;
}
