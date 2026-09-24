/**
 * @fileoverview Reading a ClickHouse `DateTime64(3, 'UTC')` value back into a `Date`.
 *
 * Writers store timestamps in ClickHouse's native `YYYY-MM-DD HH:MM:SS.sss`
 * form through `formatClickHouseDateTime64Utc`, in the file beside this one,
 * because the client does not reliably accept a JS `Date` or an ISO string for
 * a `DateTime64` column. Query results come back in that same form, and
 * `new Date()` would read it as local time rather than UTC, so this is its
 * inverse.
 *
 * @module backend/lib/parseClickHouseDateTime64Utc
 */

/**
 * Inverse of `formatClickHouseDateTime64Utc`.
 *
 * Falls back to `new Date(value)` for any unrecognized form so a future
 * ClickHouse driver upgrade that normalizes timestamps to ISO does not break
 * reads silently.
 *
 * @param value - A ClickHouse datetime string from a query result.
 * @returns The parsed `Date`.
 */
export function parseClickHouseDateTime64Utc(value: string): Date {
    const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z?$/.exec(value);
    let parsed: Date;
    if (!match) {
        parsed = new Date(value);
    } else {
        const [, year, month, day, hour, minute, second, milliseconds = '0'] = match;
        parsed = new Date(Date.UTC(
            Number(year),
            Number(month) - 1,
            Number(day),
            Number(hour),
            Number(minute),
            Number(second),
            Number(milliseconds.padEnd(3, '0'))
        ));
    }
    return parsed;
}
