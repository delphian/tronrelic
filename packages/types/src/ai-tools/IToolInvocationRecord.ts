/**
 * @file IToolInvocationRecord.ts
 *
 * Audit record written for every governed tool invocation. One row per call —
 * who triggered it, what was passed, what happened, and what it cost — so an
 * operator can reconstruct exactly what an AI run did.
 */

import type { IAiToolCapability } from './IAiToolCapability.js';
import type { IToolInvocationActor, ToolTriggerPath } from './IToolInvocationContext.js';
import type { ToolInvocationStatus } from './IToolInvocationResult.js';

/** A single governed tool invocation, persisted to the audit store. */
export interface IToolInvocationRecord {
    /** Unique record id. */
    id: string;

    /** Name of the tool invoked. */
    toolName: string;

    /** Plugin or module id that owns the tool. */
    providerId: string;

    /** Manifest id of the AI provider plugin that drove the call. */
    aiProviderId: string;

    /** Snapshot of the tool's capability class at invocation time. */
    capability: IAiToolCapability;

    /** Who triggered the call. */
    actor: IToolInvocationActor;

    /** How the call was triggered. */
    triggerPath: ToolTriggerPath;

    /** Conversation grouping id, when part of a multi-turn chat. */
    conversationId?: string;

    /**
     * Better Auth id of the end user the call ran on behalf of, when the
     * trigger path supplied one. Distinct from `actor`: the actor drove the
     * run, this principal is whose objects a user-scoped tool was authorized
     * against. Absent on admin/scheduled/programmatic runs.
     */
    endUserId?: string;

    /** Per-query id, when supplied — links the call to its run. */
    queryId?: string;

    /** Arguments passed to the handler, redacted according to `capability.sensitivity`. */
    input: Record<string, unknown>;

    /** Terminal status of the invocation. */
    status: ToolInvocationStatus;

    /** Short digest or preview of the result; the full payload is not stored. */
    resultDigest?: string;

    /** Sanitized failure reason, when the call failed or was denied. */
    error?: string;

    /** Raw upstream error body, retained for admin-only forensics. */
    errorRaw?: string;

    /** Cost of the invocation in USD, for money-spending tools. */
    costUsd?: number;

    /** Handler wall-clock duration in milliseconds. */
    durationMs: number;

    /** ISO 8601 timestamp of the invocation. */
    createdAt: string;
}
