/**
 * @fileoverview Formats a whole-number count for display.
 *
 * Uses a fixed `en-US` locale so the server render and the browser render
 * produce the same text.
 */

/** Count formatter shared by every call. */
const COUNT_FORMAT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * Group a count in thousands.
 *
 * @param value - The count.
 * @returns Text such as `"12,345"`.
 */
export function formatCount(value: number): string {
    return COUNT_FORMAT.format(value);
}
