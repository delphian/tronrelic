/**
 * @fileoverview Tests for recovering the keys that signed a TRON transaction.
 *
 * A wrong answer here would credit a transaction to a key that never signed
 * it, so the malformed cases matter as much as the good ones: they must name
 * no signer rather than a wrong one. The positive case is a real mainnet
 * delegation whose signer is not its account, and the multi-signature case
 * signs a digest with two fresh keys so the expected addresses come from
 * TronWeb rather than from the code under test.
 */
import { describe, expect, it } from 'vitest';
import TronWeb from 'tronweb';
import { secp256k1 } from '@noble/curves/secp256k1';
import { recoverSignerAddress, recoverTransactionSigners } from '../recoverTransactionSigners.js';
import { SIGNED_DELEGATION } from './signedDelegationFixture.js';

/**
 * Sign a digest the way a TRON wallet does and return the wire signature.
 *
 * @param digest - The 64-character hex digest, standing in for a transaction id.
 * @param privateKey - The signing key in hex, so the test knows which address must come back.
 * @param recoveryOffset - Added to the recovery byte; 27 reproduces the legacy form some signers send.
 * @returns The 65-byte signature as hex: r, s, and the recovery byte.
 */
function sign(digest: string, privateKey: string, recoveryOffset = 0): string {
    const signature = secp256k1.sign(digest, privateKey);
    return `${signature.toCompactHex()}${(signature.recovery + recoveryOffset).toString(16).padStart(2, '0')}`;
}

describe('recoverTransactionSigners', () => {
    it('recovers the key that signed for the account, not the account itself', () => {
        expect(recoverSignerAddress(SIGNED_DELEGATION.txId, SIGNED_DELEGATION.signature)).toBe(SIGNED_DELEGATION.signer);
        expect(recoverTransactionSigners(SIGNED_DELEGATION.txId, [SIGNED_DELEGATION.signature])).toEqual([SIGNED_DELEGATION.signer]);
        expect(SIGNED_DELEGATION.signer).not.toBe(SIGNED_DELEGATION.account);
    });

    it('reads the first 65 bytes of a padded signature, as java-tron does', () => {
        expect(recoverSignerAddress(SIGNED_DELEGATION.txId, `${SIGNED_DELEGATION.signature}000000`)).toBe(SIGNED_DELEGATION.signer);
    });

    it('recovers every key of a multi-signature transaction in order, including a legacy recovery byte', () => {
        const digest = 'ab'.repeat(32);
        const first = TronWeb.utils.accounts.generateAccount();
        const second = TronWeb.utils.accounts.generateAccount();

        const signers = recoverTransactionSigners(digest, [sign(digest, first.privateKey), sign(digest, second.privateKey, 27)]);

        expect(signers).toEqual([first.address.base58, second.address.base58]);
    });

    it('names no signer for a malformed signature or id, and skips it in a list', () => {
        expect(recoverSignerAddress(SIGNED_DELEGATION.txId, SIGNED_DELEGATION.signature.slice(2))).toBeNull();
        expect(recoverSignerAddress(SIGNED_DELEGATION.txId.slice(2), SIGNED_DELEGATION.signature)).toBeNull();
        expect(recoverSignerAddress(SIGNED_DELEGATION.txId, 'zz'.repeat(65))).toBeNull();
        expect(recoverTransactionSigners(SIGNED_DELEGATION.txId, ['zz', SIGNED_DELEGATION.signature])).toEqual([SIGNED_DELEGATION.signer]);
        expect(recoverTransactionSigners(SIGNED_DELEGATION.txId, [])).toEqual([]);
    });

    it('lists a key once even when it appears twice', () => {
        expect(recoverTransactionSigners(SIGNED_DELEGATION.txId, [SIGNED_DELEGATION.signature, SIGNED_DELEGATION.signature])).toEqual([SIGNED_DELEGATION.signer]);
    });
});
