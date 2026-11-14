/**
 * @file IMcpGroupLimits.ts
 *
 * The call limits an admin sets on one user group for MCP tool calls charged
 * to it.
 */

/**
 * Call limits for the tools one group grants.
 *
 * Every MCP call is charged to exactly one group (see the MCP module README,
 * "Charging a call to a group"), and that group's limits decide whether it may
 * run. A "caller" is one signed-in account, or for the `anonymous` group one
 * network range (a /24 for IPv4, a /64 for IPv6). Day limits count over a fixed
 * 24-hour window that starts with the first call, not over a calendar day.
 *
 * A `null` limit means the group sets no limit of that kind. The platform's own
 * per-caller ceiling of 60 calls a minute and 30 calls a minute per tool still
 * applies, so `null` never means unlimited. The `anonymous` group may not
 * leave any limit `null`, because its callers are strangers.
 */
export interface IMcpGroupLimits {
    /** Calls one caller may make per minute through this group, or null for the platform ceiling only. */
    callsPerMinutePerCaller: number | null;

    /** Calls one caller may make per 24 hours through this group, or null for no daily cap. */
    callsPerDayPerCaller: number | null;

    /**
     * Calls every caller together may make per 24 hours through this group, or
     * null for no pooled cap. This is the ceiling that bounds what the group
     * can cost in total, whatever the number of callers.
     */
    callsPerDayGroup: number | null;
}
