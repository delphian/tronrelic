/**
 * @file IToolHandlerContext.ts
 *
 * The part of a tool call's invocation context the governor hands to the
 * tool's handler. A handler otherwise sees only the model's input and the end
 * user, so it cannot tell one agent run from another. A tool that spends a
 * shared budget, such as a ClickHouse account's hourly quota, needs that
 * identity to charge each run separately, and a tool that records its own
 * queries needs it to link them back to the run's audit trail.
 */

import type { ToolTriggerPath } from './IToolInvocationContext.js';

/**
 * Run identity for one tool call, copied by the governor from the trusted
 * invocation context. None of it comes from the model's input, so a model
 * cannot choose which run its call is charged to.
 */
export interface IToolHandlerContext {
    /** How the run was triggered: an admin at the controls, a schedule, or code. */
    triggerPath: ToolTriggerPath;

    /** Per-query id of the run, when the provider supplied one. */
    queryId?: string;

    /** Conversation the run belongs to, when it is part of a multi-turn chat. */
    conversationId?: string;

    /** Id of this individual tool call, when the provider supplied one. */
    toolUseId?: string;
}
