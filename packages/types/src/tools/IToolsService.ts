/**
 * @fileoverview Tools service interface for shared TRON utility operations.
 *
 * Exposes general-purpose wallet and address utilities via the service registry
 * so plugins and modules can consume them without importing concrete implementations.
 * Registered as 'tools' on the IServiceRegistry during ToolsModule.run().
 */

import type { IAddressConversionResult, IAddressValidationResult } from './IToolsTypes.js';

/**
 * Service interface for TRON address and wallet utilities.
 *
 * Provides deterministic wallet analysis, address format conversion, and
 * other general-purpose blockchain operations that multiple consumers need.
 */
export interface IToolsService {
    /**
     * Convert between TRON hex and base58check address formats.
     *
     * Accepts either format and returns both. Normalizes hex input by stripping
     * 0x prefix and prepending 41 if missing.
     *
     * @param input - Object with either hex or base58Check field populated
     * @returns Both hex and base58check representations
     * @throws If the input address is invalid
     */
    convertAddress(input: { hex?: string; base58Check?: string }): IAddressConversionResult;

    /**
     * Derive the yin/yang gender of a TRON wallet address from its raw bytes.
     *
     * Decodes the base58 address to its 25-byte form (1 version + 20 address
     * + 4 checksum), sums the first 21 bytes (the wallet's essential identity,
     * excluding the computed checksum), and reads the parity: odd sum = yang =
     * male, even sum = yin = female.
     *
     * This yields an approximately 50/50 distribution across the address space.
     *
     * @param address - A 34-character TRON address starting with 'T'
     * @returns 'male' for yang (odd byte sum) or 'female' for yin (even byte sum)
     * @throws If the address contains invalid base58 characters
     */
    deriveGender(address: string): 'male' | 'female';

    /**
     * Validate whether a string is a well-formed TRON address.
     *
     * Checks format (base58 or hex), prefix, length, and checksum without
     * throwing on invalid input. When valid, returns both normalized address
     * formats for convenience.
     *
     * @param input - Candidate address string in base58 or hex format
     * @returns Validation result with format detection and normalized addresses
     */
    validateAddress(input: string): IAddressValidationResult;
}
