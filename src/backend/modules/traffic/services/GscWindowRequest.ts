/**
 * @fileoverview The window a Search Console read covers, as a caller asks for it.
 *
 * The archive holds every fetched day, so a caller can ask for a recent span,
 * an exact range of days, or everything stored. `GscService` turns each kind
 * into concrete days: a period ends on the newest day Google has delivered,
 * and `all` starts on the oldest archived day.
 */

/**
 * - `period` — the latest `hours` of delivered data, rounded up to whole days.
 * - `range` — the exact days from `startDate` to `endDate` (YYYY-MM-DD), inclusive.
 * - `all` — every archived day.
 */
export type GscWindowRequest =
    | { kind: 'period'; hours: number }
    | { kind: 'range'; startDate: string; endDate: string }
    | { kind: 'all' };
