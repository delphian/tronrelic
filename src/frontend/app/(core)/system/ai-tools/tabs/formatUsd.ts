/**
 * @file formatUsd.ts
 *
 * One formatter for every USD figure the Query tab shows — a turn's cost, a
 * conversation's running total, and a history row's sum. Shared so the three
 * places cannot drift into different precisions for the same number.
 */

/**
 * Format a provider-estimated USD cost for display, with precision that stays
 * useful at the sub-cent scale of a single turn while staying readable at the
 * dollar scale of a whole conversation. Mirrors the provider's own formatting so
 * the core Query tab reads identically to the plugin's query tool. The provider
 * computes the figure (it owns the rate card); core only renders it.
 *
 * @param amount - Cost in USD, or null/undefined when the turn was not priced.
 * @returns A display string (e.g. '$0.0042', '<$0.0001', '$1.27'), or '—'.
 */
export function formatUsd(amount: number | null | undefined): string {
    let formatted: string;
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
        formatted = '—';
    } else if (amount <= 0) {
        formatted = '$0.00';
    } else if (amount < 0.0001) {
        formatted = '<$0.0001';
    } else if (amount < 1) {
        formatted = `$${amount.toFixed(4)}`;
    } else {
        formatted = `$${amount.toFixed(2)}`;
    }
    return formatted;
}
