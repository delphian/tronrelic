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

    /**
     * Recover the keys that signed a TRON transaction from its signatures.
     *
     * A transaction's permission id names a slot on the signing account, not
     * the key that signed, and one slot can hold several platforms' keys. The
     * key recovered from the signature is the only reliable answer to who
     * signed, so code attributing a transaction to a key uses this rather
     * than the permission id. Synchronous and stateless, so it is safe on the
     * live block path; it costs about 1.4 ms per signature.
     *
     * @param txId - The 64-character hex transaction id, which is the digest each key signed
     * @param signatures - The transaction's hex wire signatures; a signature longer than 65 bytes is read as its first 65, as java-tron does
     * @returns The distinct Base58 signers in signature order; a signature that cannot be recovered is left out, so a result shorter than the signature list means one was unreadable
     */
    recoverTransactionSigners(txId: string, signatures: readonly string[]): string[];
}
