/**
 * @fileoverview UTC day-string helpers for the price series.
 *
 * Why a dedicated helper set: the whole module keys on a bare `YYYY-MM-DD` UTC
 * day (so prices join to the ledger's day buckets without a timezone re-derive),
 * and both the provider and the service walk, compare, and convert those day
 * strings. Centralizing the arithmetic here keeps every call site on the same
 * UTC boundary and out of local-timezone bugs.
 */

/**
 * Project a Date to its UTC calendar day.
 *
 * @param date - Any instant.
 * @returns The `YYYY-MM-DD` of that instant in UTC.
 */
export function toUtcDay(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/**
 * Today's UTC day — the forward edge the daily append targets.
 *
 * @returns Current `YYYY-MM-DD` in UTC.
 */
export function todayUtcDay(): string {
    return toUtcDay(new Date());
}

/**
 * Parse a `YYYY-MM-DD` day to the Date at its UTC midnight, the canonical instant
 * for that day used by all the arithmetic below.
 *
 * @param day - UTC `YYYY-MM-DD`.
 * @returns The Date at `day`T00:00:00Z.
 */
export function parseUtcDay(day: string): Date {
    return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Shift a day by a signed number of days, staying on the UTC boundary — the
 * primitive the backward backfill and forward append both walk with.
 *
 * @param day - UTC `YYYY-MM-DD`.
 * @param deltaDays - Days to add (negative to go back).
 * @returns The shifted `YYYY-MM-DD`.
 */
export function shiftUtcDay(day: string, deltaDays: number): string {
    const date = parseUtcDay(day);
    date.setUTCDate(date.getUTCDate() + deltaDays);
    return toUtcDay(date);
}

/**
 * The day before `day`, used to step the backward backfill one day older.
 *
 * @param day - UTC `YYYY-MM-DD`.
 * @returns The previous `YYYY-MM-DD`.
 */
export function previousUtcDay(day: string): string {
    return shiftUtcDay(day, -1);
}

/**
 * The UTC-midnight epoch-second of a day — the `from` bound CoinGecko's ranged
 * endpoint expects.
 *
 * @param day - UTC `YYYY-MM-DD`.
 * @returns Epoch seconds at the day's UTC start.
 */
export function utcDayStartSeconds(day: string): number {
    return Math.floor(parseUtcDay(day).getTime() / 1000);
}

/**
 * The last epoch-second of a day — the `to` bound that keeps a single-day range
 * query from spilling into the next day.
 *
 * @param day - UTC `YYYY-MM-DD`.
 * @returns Epoch seconds at the day's UTC end (23:59:59).
 */
export function utcDayEndSeconds(day: string): number {
    return utcDayStartSeconds(day) + 86_400 - 1;
}

/**
 * Convert a day to CoinGecko's `/history` date format. That endpoint is the only
 * deep-history path on the free tier and it expects `DD-MM-YYYY`, not ISO.
 *
 * @param day - UTC `YYYY-MM-DD`.
 * @returns The same day as `DD-MM-YYYY`.
 */
export function toCoinGeckoHistoryDate(day: string): string {
    const [year, month, date] = day.split('-');
    return `${date}-${month}-${year}`;
}

/**
 * Whole-day distance between two days, used to bound how wide a ranged seed asks
 * for and to detect when a backfill has reached its lookback floor.
 *
 * @param fromDay - Earlier UTC `YYYY-MM-DD`.
 * @param toDay - Later UTC `YYYY-MM-DD`.
 * @returns Signed day count `toDay - fromDay`.
 */
export function diffUtcDays(fromDay: string, toDay: string): number {
    return Math.round((parseUtcDay(toDay).getTime() - parseUtcDay(fromDay).getTime()) / 86_400_000);
}
