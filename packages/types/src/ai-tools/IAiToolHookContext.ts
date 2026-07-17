/**
 * @file IAiToolHookContext.ts
 *
 * Invocation metadata shared by the two mutating AI-tool hook seams. The
 * pre-execution seam (`ai.toolInvoke`, series) inspects a pending call and may
 * veto or hold it by throwing `HookAbortError`. The pre-return seam
 * (`ai.toolResult`, waterfall) receives the same metadata as its input and the
 * tool's raw result as the threaded value, so a handler may alter the result or
 * throw `HookAbortError` to withhold it from the model. Both seams carry this one
 * payload; the metadata a handler needs is identical, only the threaded result
 * differs. The audit-only seam (`ai.toolInvoked`) is an observer fired with the
 * completed `IToolInvocationRecord`, so it needs no dedicated payload type.
 */

import type { IAiToolCapability } from './IAiToolCapability.js';
import type { IToolInvocationContext } from './IToolInvocationContext.js';

/**
 * The tool invocation metadata handed to `ai.toolInvoke` handlers (before the
 * governor executes the tool) and to `ai.toolResult` handlers (after execution,
 * alongside the threaded result). Handlers treat it as read-only; to block or
 * withhold the call they throw `HookAbortError`.
 */
export interface IAiToolInvokeContext {
    /** Name of the tool about to run. */
    toolName: string;

    /** Plugin or module id that owns the tool. */
    providerId: string;

    /** The tool's capability classification, when declared. */
    capability?: IAiToolCapability;

    /** Validated arguments the model supplied. */
    input: Record<string, unknown>;

    /** Caller and trigger context for the invocation. */
    context: IToolInvocationContext;
}
