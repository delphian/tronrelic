/**
 * @file IToolCallerBudget.ts
 *
 * The rate budget an external entry point asks the governor to charge one
 * tool call against.
 */

/**
 * Per-caller and pooled limits for one tool call, set by a trusted entry point
 * such as the MCP endpoint and enforced by the governor's policy engine.
 *
 * The engine stays unaware of groups, endpoints, and principals: it only
 * counts calls under the keys given here and refuses a call that would pass a
 * limit. The entry point decides who the caller is and which group's limits
 * apply, which keeps that knowledge in one place. Keys are opaque strings and
 * must already be unique across callers and groups.
 *
 * Set from verified credentials, never from model input.
 */
export interface IToolCallerBudget {
    /**
     * Counter key for this caller's minute windows, such as
     * `mcp:anonymous:3fa9c2d1e0b7a6f4`. The same for every call the caller
     * makes, so the minute ceilings hold across everything it calls.
     */
    callerKey: string;

    /**
     * Counter key for this caller's 24-hour window, when it should be counted
     * separately from other calls by the same caller, such as one key per
     * group the call is charged to. Defaults to a key derived from `callerKey`.
     */
    dayKey?: string;

    /** Most calls this caller may make per minute across every tool. */
    callsPerMinute: number;

    /** Most calls this caller may make per minute to one tool. */
    callsPerMinutePerTool: number;

    /** Most calls this caller may make per 24-hour window, when capped. */
    callsPerDay?: number;

    /** Counter key shared by every caller charged to the same pool, such as `mcp-pool:anonymous`. */
    poolKey?: string;

    /** Most calls every caller in the pool together may make per 24-hour window, when capped. */
    poolCallsPerDay?: number;
}
