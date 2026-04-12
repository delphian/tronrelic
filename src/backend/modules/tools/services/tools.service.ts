/**
 * @fileoverview Facade service exposing shared tools utilities via the service registry.
 *
 * Wraps AddressService and adds general-purpose wallet analysis methods
 * (deriveGender) so plugins and modules can consume them through
 * IToolsService without importing concrete implementations.
 */

import type { IToolsService, IAddressConversionResult, IAddressValidationResult } from '@/types';
import type { AddressService } from './address.service.js';

/**
 * Shared tools service registered as 'tools' on the service registry.
 *
 * Provides address conversion and deterministic wallet analysis to any
 * consumer that discovers it via IServiceRegistry.get<IToolsService>('tools').
 */
export class ToolsService implements IToolsService {
    /**
     * @param addressService - Injected AddressService for format conversion
     */
    constructor(private readonly addressService: AddressService) {}

    /**
     * Convert between TRON hex and base58check address formats.
     *
     * @param input - Object with either hex or base58Check field populated
     * @returns Both hex and base58check representations
     * @throws If the input address is invalid
     */
    convertAddress(input: { hex?: string; base58Check?: string }): IAddressConversionResult {
        return this.addressService.convertAddress(input);
    }

    /**
     * Validate whether a string is a well-formed TRON address.
     *
     * Delegates to AddressService for format detection, prefix/length
     * checking, and TronWeb checksum verification. Never throws on
     * invalid input — returns a result object instead.
     *
     * @param input - Candidate address string in base58 or hex format
     * @returns Validation result with format detection and normalized addresses
     */
    validateAddress(input: string): IAddressValidationResult {
        return this.addressService.validateAddress(input);
    }

    /**
     * Derive the yin/yang gender of a TRON wallet address from its raw bytes.
     *
     * Converts the base58check address to hex via AddressService (which
     * validates length, prefix, and checksum), sums the hex bytes representing
     * the 21-byte identity (version + address, excluding checksum), and reads
     * parity per I Ching convention: odd = yang = male, even = yin = female.
     *
     * @param address - A 34-character TRON address starting with 'T'
     * @returns 'male' for yang (odd byte sum) or 'female' for yin (even byte sum)
     * @throws If the address is invalid (bad characters, length, prefix, or checksum)
     */
    deriveGender(address: string): 'male' | 'female' {
        const { hex } = this.addressService.convertAddress({ base58Check: address });

        let byteSum = 0;
        for (let i = 0; i < 42; i += 2) {
            byteSum += parseInt(hex.slice(i, i + 2), 16);
        }

        return byteSum % 2 === 1 ? 'male' : 'female';
    }
}
