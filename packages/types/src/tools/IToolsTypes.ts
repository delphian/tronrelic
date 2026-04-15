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

/**
 * Address validation result indicating whether a TRON address is well-formed.
 */
export interface IAddressValidationResult {
    /** Whether the address passed all validation checks. */
    valid: boolean;
    /** Detected format of the input, or null if unrecognizable. */
    format: 'base58' | 'hex' | null;
    /** Normalized base58check address when valid, undefined otherwise. */
    base58check?: string;
    /** Normalized hex address when valid, undefined otherwise. */
    hex?: string;
    /** Human-readable reason when validation fails. */
    error?: string;
}
