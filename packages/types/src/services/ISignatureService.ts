/**
 * Signature verification service interface for TRON wallet ownership proofs.
 *
 * Wraps TronWeb's signature verification and address normalization so that
 * consumers never import tronweb directly. Stateless — safe to share a
 * single instance across all callers.
 */
export interface ISignatureService {
    /**
     * Verify a TronLink-signed message and return the normalized address.
     *
     * Throws if the signature is invalid or the address format is
     * unrecognised. On success the returned address is always base58.
     *
     * @param address - TRON address that allegedly signed the message
     * @param message - The plain-text message that was signed
     * @param signature - Hex-encoded TronLink signature
     * @returns Normalised base58 address of the signer
     * @throws Error when the signature does not match
     */
    verifyMessage(address: string, message: string, signature: string): Promise<string>;

    /**
     * Normalize a TRON address to base58 format.
     *
     * Accepts hex (41-prefixed) and base58 (T-prefixed) addresses.
     *
     * @param address - TRON address in hex or base58 format
     * @returns Base58 encoded address
     * @throws Error when the address format is invalid
     */
    normalizeAddress(address: string): string;
}
