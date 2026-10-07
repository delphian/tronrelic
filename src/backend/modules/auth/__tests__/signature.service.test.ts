/**
 * @fileoverview Tests for SignatureService against the real libraries: verifyMessage
 * through TronWeb, and recoverTransactionSigners on a real mainnet delegation.
 *
 * Why these exist: every wallet-ownership proof in the platform (wallet
 * linking, forum authorship, tool gates) goes through this one method, and it
 * once accepted any well-formed signature for any claimed wallet. TronWeb's
 * `verifyMessageV2` returns the address it recovers from the signature rather
 * than a boolean, so a check that treated the return value as true/false
 * passed for forged proofs. Every earlier test stubbed the library to resolve
 * `true`, which is why nothing caught it. These tests use the real library so
 * the contract with TronWeb is exercised, not assumed.
 *
 * Signing and recovery are local elliptic-curve operations, so no request
 * leaves the process even though a TronWeb instance is constructed.
 */
import { describe, it, expect } from 'vitest';
import TronWeb from 'tronweb';
import { SIGNED_DELEGATION } from '../../../lib/__tests__/signedDelegationFixture.js';
import { SignatureService } from '../signature.service.js';

/** Host TronWeb is configured with; unreachable on purpose, since no test may touch the network. */
const OFFLINE_HOST = 'http://127.0.0.1:1';

/** The message every positive case signs, so a mismatch in the negative cases is the only variable. */
const MESSAGE = 'Forum post by test at 1700000000000: hello';

/**
 * Build a service over a real TronWeb instance plus two independent wallets.
 *
 * @returns The service under test, a real TronWeb instance for signing, and two distinct keypairs so tests can pair one wallet's signature with the other's address
 */
function setup() {
    const tronWeb = new TronWeb({ fullHost: OFFLINE_HOST });
    const service = new SignatureService(tronWeb);
    const walletA = TronWeb.utils.accounts.generateAccount();
    const walletB = TronWeb.utils.accounts.generateAccount();
    return { tronWeb, service, walletA, walletB };
}

describe('SignatureService.verifyMessage', () => {
    it('accepts a signature made by the claimed wallet over the same message', async () => {
        const { tronWeb, service, walletA } = setup();
        const signature = await tronWeb.trx.signMessageV2(MESSAGE, walletA.privateKey);

        await expect(service.verifyMessage(walletA.address.base58, MESSAGE, signature))
            .resolves.toBe(walletA.address.base58);
    });

    it('accepts the claimed address in hex form and returns it normalized to base58', async () => {
        const { tronWeb, service, walletA } = setup();
        const signature = await tronWeb.trx.signMessageV2(MESSAGE, walletA.privateKey);

        await expect(service.verifyMessage(walletA.address.hex, MESSAGE, signature))
            .resolves.toBe(walletA.address.base58);
    });

    it('rejects a valid signature presented for a different wallet', async () => {
        const { tronWeb, service, walletA, walletB } = setup();
        const signature = await tronWeb.trx.signMessageV2(MESSAGE, walletA.privateKey);

        await expect(service.verifyMessage(walletB.address.base58, MESSAGE, signature))
            .rejects.toThrow('Invalid signature provided');
    });

    it('rejects a signature reused over a different message', async () => {
        const { tronWeb, service, walletA } = setup();
        const signature = await tronWeb.trx.signMessageV2(MESSAGE, walletA.privateKey);

        await expect(service.verifyMessage(walletA.address.base58, `${MESSAGE} (edited)`, signature))
            .rejects.toThrow('Invalid signature provided');
    });

    it('rejects a malformed signature instead of surfacing the library error', async () => {
        const { service, walletA } = setup();

        await expect(service.verifyMessage(walletA.address.base58, MESSAGE, '0xdeadbeef'))
            .rejects.toThrow('Invalid signature provided');
    });
});

describe('SignatureService.recoverTransactionSigners', () => {
    it('hands plugins the key that signed a delegation for another wallet', () => {
        const { service } = setup();

        expect(service.recoverTransactionSigners(SIGNED_DELEGATION.txId, [SIGNED_DELEGATION.signature]))
            .toEqual([SIGNED_DELEGATION.signer]);
    });
});
