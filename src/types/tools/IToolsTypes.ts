/**
 * @fileoverview Shared type definitions for the tools service interface.
 */

/**
 * Address conversion result containing both TRON address formats.
 */
export interface IAddressConversionResult {
    /** 41-prefixed uppercase hex address (42 characters). */
    hex: string;
    /** T-prefixed base58check address (34 characters). */
    base58check: string;
}
