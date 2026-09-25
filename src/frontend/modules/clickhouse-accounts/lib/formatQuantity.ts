/**
 * @fileoverview Plain-language formatting for the quantities the ClickHouse
 * accounts page shows: counts, seconds, and durations.
 *
 * Limits run from single digits (threads) to tens of billions (rows per hour),
 * so raw integers are unreadable at a glance. These helpers give each kind of
 * quantity one consistent short form. The locale is fixed to English so the
 * output is the same on every machine, which keeps formatted figures stable in
 * tests and across admins.
 */

const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const WHOLE = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

/**
 * Format a count compactly, such as 50,000,000 as "50M".
 *
 * @param value - The count.
 * @returns The compact form.
 */
export function formatCount(value: number): string {
    return COMPACT.format(value);
}

/**
 * Format a whole number with thousands separators, for places where the exact
 * value matters, such as next to an input an admin is typing into.
 *
 * @param value - The number.
 * @returns The grouped form.
 */
export function formatExact(value: number): string {
    return WHOLE.format(value);
}

/**
 * Format a number of seconds as a short duration, such as 600 as "10 min".
 *
 * @param seconds - The duration in seconds.
 * @returns Seconds below a minute, minutes below an hour, hours above.
 */
export function formatSeconds(seconds: number): string {
    let text: string;
    if (seconds < 60) {
        text = `${Math.round(seconds * 10) / 10} s`;
    } else if (seconds < 3600) {
        text = `${Math.round((seconds / 60) * 10) / 10} min`;
    } else {
        text = `${Math.round((seconds / 3600) * 10) / 10} h`;
    }

    return text;
}

/**
 * Format a duration in milliseconds, such as a query's run time.
 *
 * @param ms - The duration in milliseconds.
 * @returns Milliseconds below a second, otherwise the seconds form.
 */
export function formatMilliseconds(ms: number): string {
    return ms < 1000 ? `${Math.round(ms)} ms` : formatSeconds(ms / 1000);
}
