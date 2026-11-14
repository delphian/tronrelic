/**
 * @file IMcpUsageFigures.ts
 *
 * The counts every row of the MCP usage view carries, whatever it groups by.
 */

/**
 * Call counts for one slice of MCP traffic: the whole endpoint, one group,
 * one tool within a group, or one caller.
 *
 * Every call is counted once, under exactly one outcome. `refused` covers
 * every call that did not run: a limit, a missing grant, a switched-off group,
 * or any other gate. `limited` is the part of `refused` caused by a rate,
 * daily, pool, or cost limit, which is the figure that says a limit is too
 * tight or a caller is pushing against it.
 */
export interface IMcpUsageFigures {
    /** Every call, whatever its outcome. */
    calls: number;

    /** Calls whose tool ran and returned. */
    succeeded: number;

    /** Calls refused before the tool ran. */
    refused: number;

    /** The refused calls stopped by a rate, daily, pool, or cost limit. */
    limited: number;

    /** Calls whose tool ran and failed. */
    failed: number;

    /** Distinct callers: accounts, or network ranges for anonymous callers. */
    callers: number;

    /** 95th percentile run time in milliseconds of calls whose tool ran, or null when none ran. */
    p95DurationMs: number | null;

    /** Sum of the recorded cost in US dollars, for tools that charge per call. */
    costUsd: number;
}
