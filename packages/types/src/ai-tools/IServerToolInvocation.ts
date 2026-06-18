/**
 * @file IServerToolInvocation.ts
 *
 * Facts an AI provider supplies to the governor to audit a *server-side* tool
 * call — one the model invoked but that executed on the provider's own
 * infrastructure (e.g. Anthropic's `web_search` / `web_fetch`) rather than
 * through `IAiToolGovernor.invoke()`. These tools never run a platform handler,
 * so the governor cannot mediate them; recording them after the fact restores
 * the audit trail and attribution the governed path provides, and feeds the
 * lethal-trifecta watch (the `ai.toolInvoked` observer) the same way a governed
 * call does.
 */

import type { IAiToolCapability } from './IAiToolCapability.js';
import type { IToolInvocationContext } from './IToolInvocationContext.js';
import type { ToolInvocationStatus } from './IToolInvocationResult.js';

/**
 * A completed server-side tool call, reported to the governor for audit. The
 * provider has already run the call (on the vendor's side) and knows its
 * outcome, so only the terminal `ok` / `error` statuses apply — there is no
 * approval or policy stage for a tool the governor cannot intercept.
 */
export interface IServerToolInvocation {
    /** Tool name as it appears in the provider's response (e.g. `web_fetch`). */
    toolName: string;

    /**
     * Governance classification the provider assigns the server tool, so the
     * audit record and trifecta accounting credit the right legs (a web fetch
     * is `external` egress *and* `surfacesUntrustedContent` ingress).
     */
    capability: IAiToolCapability;

    /** Arguments the model passed (the search query, the fetched URL, …). */
    input: Record<string, unknown>;

    /** Terminal outcome — the call already ran on the provider's side. */
    status: Extract<ToolInvocationStatus, 'ok' | 'error'>;

    /** Caller/trigger context, for attribution identical to a governed call. */
    context: IToolInvocationContext;

    /** Short digest of the result, when the call succeeded. */
    resultDigest?: string;

    /** Failure reason, when the call errored on the provider's side. */
    error?: string;
}
