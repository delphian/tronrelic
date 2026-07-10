/**
 * @fileoverview Shared formatting helpers for the wallet-detail view.
 *
 * The detail panels all render the same handful of on-chain quantities — TRX
 * amounts stored in sun, raw token integers, long base58 addresses, large
 * counts. Centralising the conversions keeps every panel consistent (one wallet
 * never shows "1,000 TRX" while another shows "1000.000000") and keeps the unit
 * math (sun → TRX, raw → decimal token) in one audited place instead of scattered
 * across components.
 */

/** Sun per TRX — TRON's smallest unit is 1e-6 TRX. */
const SUN_PER_TRX = 1_000_000;

/**
 * Format a sun amount as a human TRX string. Capped at two fraction digits — the
 * wallet tab reads as a ledger, and TRX's full six-place precision is noise there:
 * long tails misalign columns and bury the magnitude that actually matters. This
 * only ever *reduces* precision: `maximumFractionDigits` rounds a long tail to two
 * places while the default `minimumFractionDigits` of 0 leaves whole amounts
 * unpadded, so `1234` stays `"1,234 TRX"` and `1234.5678` reads `"1,234.57 TRX"`.
 *
 * @param sun - The amount in sun.
 * @returns A grouped TRX string, e.g. `"1,234.57 TRX"`.
 */
export function formatTrxFromSun(sun: number): string {
    const trx = sun / SUN_PER_TRX;
    return `${trx.toLocaleString(undefined, { maximumFractionDigits: 2 })} TRX`;
}

/**
 * Format a raw integer token amount (decimals unapplied) as a human string with
 * its symbol, applying the token's decimal places.
 *
 * @param raw - The raw integer token amount.
 * @param decimals - The token's decimal places.
 * @param symbol - The token symbol to append (e.g. `USDT`).
 * @returns A grouped token string, e.g. `"250 USDT"`.
 */
export function formatTokenAmount(raw: number, decimals: number, symbol: string): string {
    const value = raw / Math.pow(10, decimals);
    return `${value.toLocaleString(undefined, { maximumFractionDigits: decimals })} ${symbol}`;
}

/**
 * Convert a sun amount to a plain TRX number, for chart values where the unit is
 * carried by the axis label rather than each datum.
 *
 * @param sun - The amount in sun.
 * @returns The amount in TRX.
 */
export function trxFromSun(sun: number): number {
    return sun / SUN_PER_TRX;
}

/**
 * Convert a raw 6-decimal token integer (USDT's precision) to a plain number,
 * for chart values denominated in whole tokens.
 *
 * @param raw - The raw integer amount at 6 decimals.
 * @returns The amount in whole tokens.
 */
export function usdtFromRaw(raw: number): number {
    return raw / SUN_PER_TRX;
}

/**
 * Abbreviate a long base58 address to a glanceable `head…tail` form, so a
 * counterparty table or feed row stays scannable without losing the ends users
 * recognise an address by.
 *
 * @param address - The full base58 address.
 * @returns The abbreviated address, or the original when already short.
 */
export function truncateAddress(address: string): string {
    if (address.length <= 16) {
        return address;
    }
    return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

/**
 * Format an integer count with locale grouping.
 *
 * @param value - The count.
 * @returns The grouped count string, e.g. `"12,345"`.
 */
export function formatCount(value: number): string {
    return value.toLocaleString();
}
