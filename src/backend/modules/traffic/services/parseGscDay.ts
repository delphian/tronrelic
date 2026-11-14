/**
 * @fileoverview Calendar-day helpers shared by the Search Console reads and the backfill.
 *
 * Search Console reports data per calendar day as `YYYY-MM-DD`, and the
 * service stores each day as midnight UTC. Every place that accepts a day
 * from a caller or turns a stored day back into text uses these helpers, so
 * all of them reject the same malformed input.
 */

/** A calendar day as Search Console writes it. */
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Render a UTC-midnight Date as `YYYY-MM-DD`, the form Search Console and
 * ClickHouse `Date` columns use.
 *
 * @param date - Any instant; only its UTC calendar date is used.
 * @returns The day key.
 */
export function toGscDayKey(date: Date): string {
    return date.toISOString().split('T')[0];
}

/**
 * Parse a `YYYY-MM-DD` string into a UTC-midnight Date.
 *
 * Rejects a day that does not exist, such as February 30th, which `Date`
 * would otherwise roll silently into March.
 *
 * @param value - The text a caller supplied.
 * @returns The day at midnight UTC, or null when the text is not a real day.
 */
export function parseGscDay(value: string): Date | null {
    let day: Date | null = null;
    if (DAY_KEY_PATTERN.test(value)) {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        if (!isNaN(parsed.getTime()) && toGscDayKey(parsed) === value) {
            day = parsed;
        }
    }
    return day;
}

/**
 * Validate an explicit day range a caller supplied, such as a REST query
 * string or an AI tool argument.
 *
 * @param startDate - Requested first day.
 * @param endDate - Requested last day.
 * @returns The two days unchanged.
 * @throws Error naming the problem when either is not a `YYYY-MM-DD` string
 *   for a real day, or the range is reversed.
 */
export function parseGscDayRange(startDate: unknown, endDate: unknown): { startDate: string; endDate: string } {
    const start = typeof startDate === 'string' ? parseGscDay(startDate) : null;
    const end = typeof endDate === 'string' ? parseGscDay(endDate) : null;
    if (!start || !end) {
        throw new Error('startDate and endDate must both be real days in YYYY-MM-DD form');
    }
    if (start.getTime() > end.getTime()) {
        throw new Error(`startDate ${toGscDayKey(start)} is after endDate ${toGscDayKey(end)}`);
    }
    return { startDate: toGscDayKey(start), endDate: toGscDayKey(end) };
}
