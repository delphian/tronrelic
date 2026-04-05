/**
 * @fileoverview Address conversion service for TRON hex and base58check formats.
 *
 * Provides bidirectional conversion between TRON hex addresses (41-prefixed)
 * and base58check addresses (T-prefixed). Receives TronWeb via constructor
 * injection for consistency with the module's DI pattern.
 */

import type TronWeb from 'tronweb';
import { ValidationError } from '../../../lib/errors.js';

/**
 * Address conversion result containing both formats.
 */
export interface IAddressConversionResult {
    hex: string;
    base58check: string;
}

/**
 * Service for converting between TRON hex and base58check address formats.
 *
 * Uses the injected TronWeb instance for address encoding/decoding rather
 * than importing the library directly, keeping all TronWeb access routed
 * through the service registry.
 */
export class AddressService {
    /**
     * @param tronWeb - Configured TronWeb instance from the service registry
     */
    constructor(private readonly tronWeb: TronWeb) {}

    /**
     * Convert between TRON hex and base58check address formats.
     *
     * Accepts either format and returns both. Normalizes hex input by stripping
     * 0x prefix and prepending 41 if missing (bare 40-char hex).
     *
     * @param input - Object with either hex or base58Check field populated
     * @returns Both hex and base58check representations
     * @throws ValidationError if the input address is invalid
     */
    convertAddress(input: { hex?: string; base58Check?: string }): IAddressConversionResult {
        let { hex, base58Check } = input;

        if (!hex && !base58Check) {
            throw new ValidationError('Provide hex or base58Check');
        }

        if (!base58Check && hex) {
            hex = this.normalizeHex(hex);
            base58Check = this.hexToBase58(hex);
        }

        if (!hex && base58Check) {
            hex = this.base58ToHex(base58Check);
        }

        if (!hex || !base58Check) {
            throw new ValidationError('Unable to convert address', { hex, base58Check });
        }

        return { hex, base58check: base58Check };
    }

    /**
     * Convert a normalized hex address to base58check.
     *
     * @param hex - 41-prefixed hex address (42 characters)
     * @returns Base58check encoded address
     * @throws ValidationError if hex is not a valid TRON address
     */
    private hexToBase58(hex: string): string {
        try {
            return this.tronWeb.address.fromHex(hex);
        } catch (error) {
            throw new ValidationError('Invalid Tron hex address', { hex, error });
        }
    }

    /**
     * Convert a base58check address to hex.
     *
     * @param address - T-prefixed base58check address (34 characters)
     * @returns 41-prefixed uppercase hex address
     * @throws ValidationError if address is not a valid TRON address
     */
    private base58ToHex(address: string): string {
        if (!address) {
            throw new ValidationError('Base58Check address is required');
        }
        try {
            return this.tronWeb.address.toHex(address).toUpperCase();
        } catch (error) {
            throw new ValidationError('Invalid Tron base58Check address', { address, error });
        }
    }

    /**
     * Normalize raw hex input into the 41-prefixed TRON format.
     *
     * Strips 0x prefix and prepends 41 for bare 40-character hex strings.
     *
     * @param input - Raw hex string (with or without 0x prefix)
     * @returns Normalized 42-character uppercase hex address
     * @throws ValidationError if hex does not match expected patterns
     */
    private normalizeHex(input: string): string {
        let hex = input.trim();
        if (!hex) {
            throw new ValidationError('Hex value is required');
        }
        if (hex.startsWith('0x') || hex.startsWith('0X')) {
            hex = hex.slice(2);
        }
        if (hex.length === 40) {
            hex = `41${hex}`;
        }
        if (!/^41[0-9a-fA-F]{40}$/u.test(hex)) {
            throw new ValidationError('Invalid Tron hex address', { hex: input });
        }
        return hex.toUpperCase();
    }
}
