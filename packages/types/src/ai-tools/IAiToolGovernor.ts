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
}
