/**
 * @fileoverview Converting ClickHouse `DateTime64` text to the ISO 8601 form tools return.
 *
 * ClickHouse writes a `DateTime64(3, 'UTC')` value as `2026-09-24 03:12:36.000`
 * in JSON output, with no zone marker. A model reading that cannot tell it is
 * UTC, so every time a chain query tool returns is converted to ISO 8601 with
 * a `Z` suffix first.
 *
 * @module backend/modules/blockchain/chain-query/clickHouseTime
 */

/**
 * Convert a ClickHouse UTC datetime string to ISO 8601.
 *
 * @param value - The value as ClickHouse's JSON output writes it.
 * @returns The same instant as `2026-09-24T03:12:36.000Z`, or the input
 *          unchanged when it is not in ClickHouse's datetime form.
 */
export function fromClickHouseTime(value: unknown): string {
    const text = typeof value === 'string' ? value : String(value ?? '');
    const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(text);
    return match ? `${match[1]}T${match[2]}Z` : text;
}

/**
 * The UTC calendar day of an ISO 8601 or ClickHouse datetime, as `YYYY-MM-DD`.
 * Price history is keyed by UTC day, so this is how a transfer finds its price.
 *
 * @param value - An ISO 8601 or ClickHouse datetime string.
 * @returns The day part.
 */
export function utcDay(value: string): string {
    return value.slice(0, 10);
}
