/**
 * @fileoverview Writing a `Date` in ClickHouse's native `DateTime64(3, 'UTC')` form.
 *
 * The `@clickhouse/client` JSONEachRow path does not reliably accept a JS `Date`
 * for a `DateTime64` column — an ISO string with `T`/`Z` can be rejected or
 * misparsed. ClickHouse's native `YYYY-MM-DD HH:MM:SS.sss` form is unambiguous,
 * so every writer formats its timestamps that way. The inverse, for reading
 * them back, is `parseClickHouseDateTime64Utc` in the file beside this one.
 *
 * Kept in the shared backend library because more than one component writes to
 * ClickHouse — traffic, account history, and the TRON chain data among them —
 * and a copy per component is the kind of duplicate that drifts when one is
 * fixed and the other is not.
 *
 * @module backend/lib/formatClickHouseDateTime64Utc
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
 * Used for every timestamp written to a `DateTime64(3, 'UTC')` column and for
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
