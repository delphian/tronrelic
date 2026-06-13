/**
 * @file IToolInvocationResult.ts
 *
 * Outcome the governor returns for a single tool invocation. The AI provider
 * plugin feeds `content` back to the model as the tool result and records
 * `recordId` against the run.
 */

/**
 * Terminal status of a governed invocation.
 * - `ok` — the handler ran and returned `content`.
 * - `denied` — policy blocked the call; `content`/`error` explain why.
 * - `pending-approval` — parked for human approval; `content` is the holding notice.
 * - `error` — the handler threw; `error` carries the sanitized reason.
 */
export type ToolInvocationStatus = 'ok' | 'denied' | 'pending-approval' | 'error';

/** What the governor returns to the AI provider for each tool call. */
export interface IToolInvocationResult {
    /** Terminal status of the invocation. */
    status: ToolInvocationStatus;

    /**
     * Value fed back to the model as the tool result: the handler's return on
     * `ok`; a structured notice (denial reason, approval-pending message) otherwise.
     */
    content: unknown;

    /** Sanitized error reason, present when `status` is `error` or `denied`. */
    error?: string;

    /** Id of the audit record written for this invocation. */
    recordId: string;
}
