/**
 * @fileoverview Formats exact decimal text for display.
 *
 * Token amounts arrive as decimal strings because they can exceed what a
 * JavaScript number holds exactly. Converting them to a number to format them
 * would round large balances, so the digits are grouped as text instead.
 */

/**
 * Group the whole part of a decimal string in thousands and cut its fraction
 * to a readable length, without converting it to a number.
 *
 * The result is the same on the server and in the browser, because it does
 * not depend on the visitor's locale.
 *
 * @param value - Decimal text such as `"1234567.891234"`, optionally negative.
 * @param maxFractionDigits - Most digits kept after the point; trailing zeros are dropped.
 * @returns The grouped text, such as `"1,234,567.8912"`.
 */
export function formatDecimalText(value: string, maxFractionDigits: number = 4): string {
    const negative = value.startsWith('-');
    const unsigned = negative ? value.slice(1) : value;
    const [whole = '0', fraction = ''] = unsigned.split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const trimmedFraction = fraction.slice(0, maxFractionDigits).replace(/0+$/, '');
    return `${negative ? '-' : ''}${grouped}${trimmedFraction ? `.${trimmedFraction}` : ''}`;
}
