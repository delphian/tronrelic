/**
 * @file IAiToolGovernor.ts
 *
 * The single choke point through which every AI tool invocation flows. An AI
 * provider plugin calls `invoke()` instead of running a tool's handler
 * directly; the governor validates the input, applies policy, enforces a
 * per-handler timeout, writes the audit record, and runs the pre/post hook
 * seams — so accountability and security stay uniform across providers.
 */

import type { IToolInvocationContext } from './IToolInvocationContext.js';
import type { IToolInvocationResult } from './IToolInvocationResult.js';
import type { IServerToolInvocation } from './IServerToolInvocation.js';

/**
 * Core-owned mediator for tool execution. Provider-neutral: any AI provider
 * plugin (Anthropic today, others later) routes tool calls through it.
 */
export interface IAiToolGovernor {
    /**
     * Validate, authorize, execute, and audit a single tool invocation.
     *
     * @param name - Registered tool name the model invoked.
     * @param input - Raw arguments from the model, validated against the tool's schema.
     * @param ctx - Caller and trigger context for policy and audit.
     * @returns The governed outcome to feed back to the model.
     */
    invoke(name: string, input: Record<string, unknown>, ctx: IToolInvocationContext): Promise<IToolInvocationResult>;

    /**
     * Audit a server-side tool call the governor could not mediate. A
     * provider-hosted tool (Anthropic's `web_search` / `web_fetch`) runs on the
     * vendor's infrastructure and never passes through {@link invoke}, so it
     * would otherwise leave no audit record and stay invisible to the
     * lethal-trifecta watch. The provider calls this *after* the call completes
     * to write the same {@link IToolInvocationRecord} shape and fire the
     * `ai.toolInvoked` observer seam. There is no policy, approval, or
     * rate-limit stage — the call already happened; this restores accountability
     * only.
     *
     * @param invocation - The completed server-side call's facts.
     * @returns Resolves once the audit record is written and observers notified.
     */
    recordServerToolInvocation(invocation: IServerToolInvocation): Promise<void>;
}
