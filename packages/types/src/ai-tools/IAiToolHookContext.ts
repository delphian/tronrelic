/**
 * @file IAiToolHookContext.ts
 *
 * Payload for the pre-invocation tool hook seam (`ai.toolInvoke`). A core
 * module or plugin registered on that series seam inspects a pending tool call
 * before it runs and may veto or hold it by throwing `HookAbortError`. The
 * post-invocation seam (`ai.toolInvoked`) is an observer fired with the
 * completed `IToolInvocationRecord`, so it needs no dedicated payload type.
 */

import type { IAiToolCapability } from './IAiToolCapability.js';
import type { IToolInvocationContext } from './IToolInvocationContext.js';

/**
 * The pending tool invocation handed to `ai.toolInvoke` handlers before the
 * governor executes the tool. Handlers treat it as read-only; to block the
 * call they throw `HookAbortError`.
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
