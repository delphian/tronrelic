/**
 * @fileoverview TRON signature verification and address normalization.
 *
 * Implements ISignatureService using a TronWeb instance received via
 * constructor injection. Consumers obtain TronWeb instances from
 * TronGridClient.createTronWeb() which provides platform defaults.
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
     * Every wallet-ownership proof in the platform (wallet linking, forum
     * authorship, tool and calculator gates) rests on this check, so it must
     * fail closed. TronWeb's `verifyMessageV2` does not compare against an
     * address: it recovers the signer's address from the signature and
     * returns it, and a signature over some other message simply recovers to
     * some other address. Treating that return value as a boolean accepted
     * any well-formed signature for any claimed wallet. This method therefore
     * compares the recovered address with the claimed one, and treats a
     * signature the library cannot parse (it throws) as invalid too.
     *
     * @param address - TRON address the caller claims signed the message; the proof is only valid if the signature recovers to exactly this address
     * @param message - The plain-text message that was signed, so the recovery runs over the same bytes the wallet signed
     * @param signature - Hex-encoded TronLink signature (from `signMessageV2`) whose signer is being established
     * @returns Normalized base58 address of the signer, so callers store one canonical form
     * @throws ValidationError when the signature is malformed or was not produced by `address` over `message`
     */
    async verifyMessage(address: string, message: string, signature: string): Promise<string> {
        const normalized = this.normalizeAddress(address);

        let recovered: string | null;
        try {
            recovered = await this.tronWeb.trx.verifyMessageV2(message, signature);
        } catch {
            recovered = null;
        }

        if (recovered !== normalized) {
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
