/**
 * @fileoverview Formats an approximate US dollar value for display.
 *
 * Uses a fixed `en-US` locale so the server render and the browser render
 * produce the same text, which keeps hydration from failing.
 */

import type { IAddressExplorerUsd } from '@/types';

/** Dollar formatter shared by every call. */
const USD_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

/**
 * Format a dollar value, or a dash when no price is tracked for the token.
 *
 * @param value - The value from a section row, or null.
 * @returns Text such as `"$1,234.56"`, or `"—"`.
 */
export function formatUsd(value: IAddressExplorerUsd | null): string {
    return value ? USD_FORMAT.format(value.usd) : '—';
}
