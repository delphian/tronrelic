/**
 * @fileoverview A real mainnet transaction signed by a key other than its account's own.
 *
 * Tests of signer recovery need a transaction whose recovered signer is known
 * from outside the code under test, and whose signer differs from the account
 * it acts for, because that difference is the whole reason recovery exists.
 * This delegation was made from Feee.io's main pool wallet under its
 * permission 3 and signed by Feee.io's controller key; the
 * `trp-resource-markets` and `trp-onchain-typologies` plugins test against
 * the same transaction.
 *
 * @module backend/lib/__tests__/signedDelegationFixture
 */

/** The delegation and the parties to it. */
export const SIGNED_DELEGATION = {
    /** The transaction id, which is the digest the key signed. */
    txId: 'dcefe6b74650c2d2e57d063b7eadc06e7b87ccf14e52c075339ac331475e7211',
    /** The one wire signature, 65 bytes. */
    signature: 'bdb90c603e446a6c423205e0d1395ff0ec8c0817be6718283ca037ca5de79994052a7bf55fd667c72c8b73610a90f5045cc468aea3cec269f0c05a15b5d7df5d00',
    /** The key recovered from the signature: Feee.io's controller. */
    signer: 'TGNuLPkkgsf42xdRSXYpVSqUvtFT4HEupg',
    /** The account the delegation acts for: the pool wallet, which did not sign. */
    account: 'TUAEpR16Th4pLbjECPVYTgvPyStNKyB54h',
    /** The permission slot on the pool wallet the key signed under. */
    permissionId: 3
} as const;
