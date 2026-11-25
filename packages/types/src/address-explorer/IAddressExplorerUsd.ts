/**
 * @fileoverview An approximate US dollar value on the address page.
 *
 * Values come from a daily closing price, so the page shows the price day
 * beside them rather than presenting them as exact.
 */

/**
 * An amount's approximate value in US dollars.
 */
export interface IAddressExplorerUsd {
    /** The value, rounded to cents. */
    usd: number;
    /** The UTC day of the closing price used, as `YYYY-MM-DD`. */
    priceDay: string;
}
