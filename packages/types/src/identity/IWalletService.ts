/**
 * @fileoverview Published contract for the Better Auth-keyed wallet store.
 *
 * The identity module registers its `WalletService` on the service registry
 * as `'wallets'`; modules and plugins consume it through
 * `services.get<IWalletService>('wallets')`. Keeping the interface and its
 * DTOs in `@/types` lets consumers depend on the abstraction without reaching
 * into the identity module's source.
 *
 * Wallets are a post-login profile attachment keyed by the Better Auth user
 * id. A wallet is stored only after a TronLink signature proves ownership, so
 * every persisted row is verified by construction — there is no "registered
 * (unverified)" state and no per-wallet `verified` flag.
 */

/**
 * Wallet operations the Better Auth-keyed flow supports.
 *
 * Narrower than the legacy challenge set — there is no `refresh-verification`
 * because Better Auth owns session freshness; a wallet is either linked or not.
 */
export type WalletAction = 'link' | 'unlink' | 'set-primary';

/**
 * Public wire shape for a linked wallet.
 *
 * Strips the Mongo `_id` and `userId` (implied by the authenticated session)
 * and exposes only what the profile UI needs. Date fields serialize to ISO
 * strings through Express `res.json`.
 */
export interface ILinkedWallet {
    /** Normalized base58 TRON address. */
    address: string;

    /** Whether this is the account's primary wallet. Exactly one per account. */
    isPrimary: boolean;

    /** When the wallet was first linked to this account. */
    linkedAt: Date;

    /** Most recent signature/use timestamp. */
    lastUsedAt: Date;
}

/**
 * Result of issuing a wallet challenge.
 *
 * The client signs `message` verbatim with TronLink and submits the signature
 * plus `nonce` back to the matching mutation within the TTL window.
 */
export interface IWalletChallenge {
    /** Single-use nonce bound to (userId, action, normalizedAddress). */
    nonce: string;

    /** Canonical message the client must sign verbatim. */
    message: string;

    /** Unix epoch ms when the nonce expires. */
    expiresAt: number;
}

/**
 * Signed-mutation input common to link / unlink / set-primary.
 *
 * `message` must equal the canonical challenge form for
 * `(action, normalizedAddress, nonce)`; `signature` must recover to the same
 * address. The service reconstructs and verifies both before mutating.
 */
export interface IWalletMutationInput {
    /** Submitted TRON address (hex or base58); normalized internally. */
    address: string;

    /** Canonical challenge message the client signed verbatim. */
    message: string;

    /** TronLink signature over `message`. */
    signature: string;

    /** Single-use nonce minted by {@link IWalletService.issueChallenge}. */
    nonce: string;
}

/**
 * Better Auth-keyed wallet linking service.
 *
 * Every method takes the resolved Better Auth user id as its first argument —
 * the service never reads cookies or sessions. Mutations denormalize the
 * account's primary address onto the Better Auth user record so the session
 * surfaces it without a second query.
 */
export interface IWalletService {
    /** Create the collection's indexes. Idempotent. */
    createIndexes(): Promise<void>;

    /**
     * List an account's linked wallets, oldest first.
     *
     * @param userId - Better Auth user id.
     * @returns Public wallet rows (empty when none linked).
     */
    listWallets(userId: string): Promise<ILinkedWallet[]>;

    /**
     * Mint a single-use challenge for a wallet operation.
     *
     * @param userId - Better Auth user id.
     * @param action - Operation the challenge will gate.
     * @param address - Submitted TRON address (hex or base58).
     * @returns Challenge with nonce, canonical message, and expiry.
     */
    issueChallenge(userId: string, action: WalletAction, address: string): Promise<IWalletChallenge>;

    /**
     * Link a wallet after proving ownership.
     *
     * @param userId - Better Auth user id.
     * @param input - Address, signed canonical message, signature, nonce.
     * @returns The account's wallet list after the link.
     */
    linkWallet(userId: string, input: IWalletMutationInput): Promise<ILinkedWallet[]>;

    /**
     * Unlink a wallet after proving ownership.
     *
     * @param userId - Better Auth user id.
     * @param input - Address, signed canonical message, signature, nonce.
     * @returns The account's wallet list after the unlink.
     */
    unlinkWallet(userId: string, input: IWalletMutationInput): Promise<ILinkedWallet[]>;

    /**
     * Promote an already-linked wallet to primary (step-up).
     *
     * @param userId - Better Auth user id.
     * @param input - Address, signed canonical message, signature, nonce.
     * @returns The account's wallet list after the change.
     */
    setPrimaryWallet(userId: string, input: IWalletMutationInput): Promise<ILinkedWallet[]>;
}
