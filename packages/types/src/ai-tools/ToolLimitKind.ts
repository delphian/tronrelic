/**
 * @file ToolLimitKind.ts
 *
 * Names the rate or cost limit that refused a governed tool call.
 */

/**
 * Which limit refused a tool call, recorded on the audit record so usage
 * reports can count refusals by cause without parsing the reason text.
 *
 * - `caller-minute` — the caller's own per-minute budget.
 * - `caller-tool-minute` — the caller's per-minute budget for this one tool.
 * - `caller-day` — the caller's own 24-hour budget.
 * - `pool-day` — the 24-hour budget shared by every caller charged to the same group.
 * - `tool-minute` — the per-minute budget the tool shares with every caller on its path.
 * - `global-minute` — the per-minute backstop across every tool on the path.
 * - `cost` — the tool's dollar ceiling for the day.
 */
export type ToolLimitKind =
    | 'caller-minute'
    | 'caller-tool-minute'
    | 'caller-day'
    | 'pool-day'
    | 'tool-minute'
    | 'global-minute'
    | 'cost';
