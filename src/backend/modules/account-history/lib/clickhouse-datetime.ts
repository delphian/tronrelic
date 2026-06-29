/**
 * @fileoverview ClickHouse `DateTime64(3, 'UTC')` (de)serialization helpers.
 *
 * The `@clickhouse/client` JSONEachRow path does not reliably accept a JS `Date`
 * for a `DateTime64` column — an ISO string with `T`/`Z` can be rejected or
 * misparsed. ClickHouse's native `YYYY-MM-DD HH:MM:SS.sss` form is unambiguous,
 * so account-history writes timestamps in that form and reads them back through
 * the inverse. This mirrors the proven private helpers in the traffic module;
 * it is duplicated here rather than imported because those are file-private to
 * traffic and exporting them would couple two modules through an implementation
 * detail.
 */

/**
 * Left-pad a number to a fixed width so each date component has a stable length.
 *
 * @param value - The numeric component to pad.
 * @param width - Target string width.
 * @returns Zero-padded string of at least `width` characters.
 */
function pad(value: number, width: number): string {
    return String(value).padStart(width, '0');
}

/**
 * Render a `Date` as ClickHouse's native millisecond UTC datetime literal.
 *
 * Used for every timestamp written to the `account_transactions` table and for
 * binding time-range query parameters parsed with `parseDateTimeBestEffort`.
 *
 * @param date - The instant to format (interpreted in UTC).
 * @returns A `YYYY-MM-DD HH:MM:SS.sss` string.
 */
export function formatClickHouseDateTime64Utc(date: Date): string {
    return (
        `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)} ` +
        `${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}`
    );
}

/**
 * Inverse of {@link formatClickHouseDateTime64Utc}.
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
    if (!match) {
        return new Date(value);
    }
    const [, year, month, day, hour, minute, second, milliseconds = '0'] = match;
    return new Date(Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute),
        Number(second),
        Number(milliseconds.padEnd(3, '0'))
    ));
}
