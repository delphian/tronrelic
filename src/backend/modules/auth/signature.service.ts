/**
 * @fileoverview TRON signature verification and address normalization.
 *
 * Implements ISignatureService using a TronWeb instance received via
 * constructor injection. All consumers should obtain TronWeb from the
 * IServiceRegistry ('tronweb') rather than importing the library directly.
 */

import type TronWeb from 'tronweb';
import type { ISignatureService } from '@/types';
import { ValidationError } from '../../lib/errors.js';

/**
 * Stateless signature service wrapping TronWeb's verification and address utilities.
 *
 * Receives a configured TronWeb instance via the constructor so the bootstrap
 * controls configuration and tests can inject mocks.
 */
export class SignatureService implements ISignatureService {
    /**
     * @param tronWeb - Configured TronWeb instance from the service registry
     */
    constructor(private readonly tronWeb: TronWeb) {}

    /**
     * Verify a TronLink-signed message and return the normalized address.
     *
     * @param address - TRON address that allegedly signed the message
     * @param message - The plain-text message that was signed
     * @param signature - Hex-encoded TronLink signature
     * @returns Normalized base58 address of the signer
     * @throws ValidationError when the signature does not match
     */
    async verifyMessage(address: string, message: string, signature: string): Promise<string> {
        const normalized = this.normalizeAddress(address);
        const isValid = await this.tronWeb.trx.verifyMessageV2(message, signature, normalized);
        if (!isValid) {
            throw new ValidationError('Invalid signature provided');
        }
        return normalized;
    }

    /**
     * Normalize a TRON address to base58 format.
     *
     * Accepts both hex (41-prefixed) and base58 (T-prefixed) addresses.
     *
     * @param address - TRON address in hex or base58 format
     * @returns Base58 encoded address
     * @throws ValidationError if address format is invalid
     */
    normalizeAddress(address: string): string {
        try {
            if (address.startsWith('T') && address.length === 34) {
                const hex = this.tronWeb.address.toHex(address);
                return this.tronWeb.address.fromHex(hex);
            }

            if (address.startsWith('41') || address.startsWith('0x41')) {
                return this.tronWeb.address.fromHex(address);
            }

            throw new Error('Unrecognized address format');
        } catch (error) {
            throw new ValidationError('Invalid TRON address provided', { address, error });
        }
    }
}
