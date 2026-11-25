/**
 * @fileoverview Formats a token amount for display on the address page.
 */

import type { IAddressExplorerAmount } from '@/types';
import { formatDecimalText } from './formatDecimalText';

/**
 * Format an amount in whole tokens, falling back to base units when the
 * token's decimals are unknown, so a reader is never shown a guessed value.
 *
 * @param amount - The amount from a section row.
 * @param baseUnitsSuffix - The translated words placed after a base-unit
 *        amount, such as `"base units"`, so the reader can tell it apart.
 * @returns Text such as `"1,500.25"`, or `"1,500,250,000 base units"`.
 */
export function formatAmount(amount: IAddressExplorerAmount, baseUnitsSuffix: string): string {
    return amount.value !== null ? formatDecimalText(amount.value) : `${formatDecimalText(amount.raw, 0)} ${baseUnitsSuffix}`;
}
