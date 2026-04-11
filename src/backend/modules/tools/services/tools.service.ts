/**
 * @fileoverview Facade service exposing shared tools utilities via the service registry.
 *
 * Wraps AddressService and adds general-purpose wallet analysis methods
 * (deriveGender) so plugins and modules can consume them through
 * IToolsService without importing concrete implementations.
 */

import type { IToolsService, IAddressConversionResult } from '@/types';
import type { AddressService } from './address.service.js';

/** Base58 alphabet used by TRON (identical to Bitcoin). */
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

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
     * Derive the yin/yang gender of a TRON wallet address from its raw bytes.
     *
     * Decodes the base58 address to its 25-byte form (1 version + 20 address
     * + 4 checksum), sums the first 21 bytes (the wallet's essential identity,
     * excluding the computed checksum), and reads the parity per I Ching
     * convention: odd = yang = male, even = yin = female.
     *
     * @param address - A 34-character TRON address starting with 'T'
     * @returns 'male' for yang (odd byte sum) or 'female' for yin (even byte sum)
     * @throws If the address contains invalid base58 characters
     */
    deriveGender(address: string): 'male' | 'female' {
        let num = BigInt(0);
        for (const c of address) {
            const idx = BASE58_ALPHABET.indexOf(c);
            if (idx < 0) {
                throw new Error(`Invalid base58 character '${c}' in address`);
            }
            num = num * BigInt(58) + BigInt(idx);
        }

        const raw = new Uint8Array(25);
        for (let i = 24; i >= 0; i--) {
            raw[i] = Number(num & BigInt(0xff));
            num >>= BigInt(8);
        }

        let byteSum = 0;
        for (let i = 0; i < 21; i++) {
            byteSum += raw[i];
        }

        return byteSum % 2 === 1 ? 'male' : 'female';
    }
}
