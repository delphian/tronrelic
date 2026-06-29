/**
 * @fileoverview Payload for the `http.walletLinked` observer hook.
 *
 * A registered user proves ownership of a TRON address by signing a one-time
 * challenge ("linking", aka verifying) on their profile. Linking is a domain
 * fact other components want to react to without the identity module learning
 * about them — e.g. the account-history module enrolls the freshly-verified
 * address into its backfill program. Identity fires this observer seam after the
 * wallet is persisted; reactors receive the owner and the address and nothing
 * more, keeping the seam decoupled from identity's internals.
 *
 * @module types/hooks/IWalletLinkedContext
 */

/**
 * Context handed to handlers of the `http.walletLinked` hook.
 */
export interface IWalletLinkedContext {
    /** Better Auth user id of the account that linked the wallet. */
    userId: string;
    /** Base58 TRON address that was just verified and persisted. */
    address: string;
}
