/**
 * @fileoverview Converting token amounts between base units and whole units, exactly.
 *
 * The chain data stores every amount in the token's smallest unit, such as SUN
 * for TRX. Models convert those badly: a misplaced decimal point turns 1 USDT
 * into a million. The chain query tools therefore convert every amount before
 * it reaches the model, and convert a caller's minimum amount the other way
 * before it reaches ClickHouse. Both directions work on decimal strings through
 * `BigInt`, because a TRC-20 amount is a uint256 and a JavaScript number loses
 * precision past 2^53.
 *
 * @module backend/modules/blockchain/chain-query/tokenUnits
 */

/** Matches a non-negative decimal number with an optional fractional part. */
const DECIMAL_TEXT = /^(\d+)(?:\.(\d+))?$/;

/**
 * Render a base-unit amount in whole units.
 *
 * @param raw - The amount in base units, as a decimal string.
 * @param decimals - How many decimal places the token uses.
 * @returns The amount in whole units as a decimal string, with trailing zeros
 *          removed, such as `'12.5'` for a raw `'12500000'` at 6 decimals.
 */
export function formatUnits(raw: string, decimals: number): string {
    const digits = BigInt(raw).toString(10);
    let result = digits;
    if (decimals > 0) {
        const padded = digits.padStart(decimals + 1, '0');
        const whole = padded.slice(0, padded.length - decimals);
        const fraction = padded.slice(padded.length - decimals).replace(/0+$/, '');
        result = fraction.length > 0 ? `${whole}.${fraction}` : whole;
    }
    return result;
}

/**
 * Convert a whole-unit amount a caller supplied into base units.
 *
 * Digits beyond the token's decimal places are an error rather than being
 * rounded, because a minimum amount that silently changed would filter a
 * different set of transfers than the caller asked for.
 *
 * @param value - The amount in whole units, as a number or decimal string.
 * @param decimals - How many decimal places the token uses.
 * @returns The amount in base units as a decimal string, or null when the value
 *          is negative, not a plain decimal, or more precise than the token allows.
 */
export function parseUnits(value: unknown, decimals: number): string | null {
    const text = typeof value === 'number' && Number.isFinite(value) ? toPlainDecimal(value) : typeof value === 'string' ? value.trim() : '';
    const match = DECIMAL_TEXT.exec(text);
    let result: string | null = null;
    if (match) {
        const fraction = match[2] ?? '';
        if (fraction.replace(/0+$/, '').length <= decimals) {
            const scaled = `${match[1]}${fraction.padEnd(decimals, '0').slice(0, decimals)}`;
            result = BigInt(scaled).toString(10);
        }
    }
    return result;
}

/**
 * Write a JavaScript number as a plain decimal string, never in exponent form.
 *
 * `String()` is right for ordinary values, because it gives the shortest text
 * that reads back as the same number (`0.1`, not the `0.1000000000000000055`
 * that `toFixed(20)` exposes). It switches to exponent form outside roughly
 * 1e-7 to 1e21, such as `'1e-7'` or `'1e+21'`, which the decimal pattern would
 * reject, so only those cases are rewritten.
 *
 * @param value - A finite number.
 * @returns The number without an exponent.
 */
function toPlainDecimal(value: number): string {
    let text = String(value);
    if (/e/i.test(text)) {
        text = Math.abs(value) >= 1
            ? BigInt(Math.trunc(value)).toString(10)
            : value.toFixed(20).replace(/0+$/, '').replace(/\.$/, '');
    }
    return text;
}
