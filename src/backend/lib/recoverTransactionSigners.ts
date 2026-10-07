/**
 * @fileoverview Recover which keys signed a TRON transaction.
 *
 * A transaction names an account (`owner_address`) and the permission it was
 * signed under (`Permission_id`), but neither says which key signed. A
 * permission id is a slot on that one account: the owner is 0, the witness 1,
 * and java-tron renumbers the active permissions 2 and up by their position
 * every time the account updates its permissions. Many accounts also put
 * several platforms' keys in one slot with a threshold of 1. So the only
 * reliable answer to "who signed this" is the key recovered from the
 * signature itself.
 *
 * Recovery needs nothing but the transaction id and the signatures. The id is
 * the SHA-256 of the signed bytes, which is exactly the digest every key
 * signed, so no network call and no raw transaction bytes are needed.
 * java-tron has already checked every stored signature against the permission
 * it names before accepting the transaction, so a recovered key is always one
 * the permission allowed.
 *
 * Recovery costs about 1.4 ms per signature and runs synchronously. A caller
 * recovering many transactions on the request path should yield to the event
 * loop between batches.
 *
 * @module backend/lib/recoverTransactionSigners
 */

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { toVerifiedBase58 } from './tron-address.js';

/** Hex characters of a 32-byte transaction id. */
const TXID_HEX_CHARS = 64;

/** Hex characters of a 65-byte wire signature: r, s, and the recovery byte. */
const SIGNATURE_HEX_CHARS = 130;

/** Hex characters of r and s together. */
const COMPACT_HEX_CHARS = 128;

/** Some signers add 27 to the recovery byte, as Ethereum's legacy format does. */
const LEGACY_RECOVERY_OFFSET = 27;

/** Matches text made only of hex digits. */
const HEX = /^[0-9a-fA-F]+$/;

/**
 * Recover the Base58 address behind one signature over one transaction id.
 *
 * A signature that cannot be recovered returns null rather than throwing,
 * because a wrong answer would name a key that never signed, and a caller
 * attributing transactions must be able to tell "unknown" from a signer.
 *
 * Some signers append padding after the 65 bytes, as Tron.discount's key does
 * (68 bytes ending `000000`). java-tron reads only the first 65 bytes of a
 * signature, so this does the same: a longer signature is cut to its first
 * 65 bytes, and a shorter one is refused.
 *
 * @param txId - The 64-character hex transaction id, which is the digest the key signed.
 * @param signature - One hex wire signature of at least 65 bytes, as `tron.transaction.signature` stores it.
 * @returns The signer's Base58 address, or null when it cannot be recovered.
 */
export function recoverSignerAddress(txId: string, signature: string): string | null {
    let address: string | null = null;
    const valid = typeof txId === 'string' && typeof signature === 'string'
        && txId.length === TXID_HEX_CHARS && HEX.test(txId)
        && signature.length >= SIGNATURE_HEX_CHARS && HEX.test(signature);
    if (valid) {
        try {
            const wire = signature.slice(0, SIGNATURE_HEX_CHARS);
            let recoveryBit = Number.parseInt(wire.slice(COMPACT_HEX_CHARS), 16);
            if (recoveryBit >= LEGACY_RECOVERY_OFFSET) {
                recoveryBit -= LEGACY_RECOVERY_OFFSET;
            }
            const publicKey = secp256k1.Signature.fromCompact(wire.slice(0, COMPACT_HEX_CHARS))
                .addRecoveryBit(recoveryBit)
                .recoverPublicKey(txId);
            // A TRON address is 0x41 followed by the last 20 bytes of the
            // keccak-256 of the uncompressed public key without its 0x04 prefix.
            const body = keccak_256(publicKey.toRawBytes(false).subarray(1)).subarray(12);
            address = toVerifiedBase58(`41${Buffer.from(body).toString('hex')}`);
        } catch {
            address = null;
        }
    }
    return address;
}

/**
 * Recover every distinct key that signed a transaction.
 *
 * A multi-signature transaction carries one signature per key, and a key
 * being looked for may be any of them, so all are recovered. A signature that
 * cannot be recovered is skipped, so a caller comparing the result's length
 * with the number of signatures can tell when one was unreadable.
 *
 * @param txId - The 64-character hex transaction id.
 * @param signatures - The transaction's wire signatures in the order they were sent.
 * @returns The distinct signers in signature order, empty when none could be recovered.
 */
export function recoverTransactionSigners(txId: string, signatures: readonly string[]): string[] {
    const found = new Set<string>();
    for (const signature of signatures ?? []) {
        const address = recoverSignerAddress(txId, signature);
        if (address !== null) {
            found.add(address);
        }
    }
    return [...found];
}
