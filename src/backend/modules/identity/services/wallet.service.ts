/**
 * @fileoverview Wallet linking service keyed by Better Auth user id.
 *
 * Phase 4 of the Better Auth refactor. Owns the `module_user_wallets`
 * collection — the post-login profile feature that lets an authenticated
 * Better Auth account attach one or more TRON wallets it has proven
 * ownership of. This replaces the legacy UUID-keyed `users.wallets[]`
 * embedded array (and its register/verify two-stage flow plus
 * cross-browser identity reconciliation), which the Phase 6 cutover
 * removes.
 *
 * **Why simpler than the legacy flow.** UUID identity was browser-local,
 * so the legacy code needed "registered (unverified)" wallets and a
 * winner/loser merge to bridge a wallet across browsers. Better Auth
 * identity is already portable (email-OTP / OAuth / passkey), so a
 * wallet is purely a profile attachment: prove ownership with a
 * signature, attach it, done. A wallet already held by another account
 * is a hard conflict, never a merge.
 *
 * **Identity boundary.** Callers resolve the Better Auth user id from
 * the session (`req.authSession.user.id`) *before* invoking this
 * service — the service never reads cookies or sessions. Every method
 * takes the resolved `userId` as its first argument, mirroring
 * {@link GroupService}.
 *
 * **Denormalized primary.** On every mutation the service writes the
 * account's primary address onto the Better Auth user record's
 * `primaryWallet` additional field (declared in `auth.ts`) so the
 * authorization facade can surface it on the session without a second
 * query. This collection remains the source of truth; the BA field is a
 * derived pointer, maintained the same way {@link GroupService}
 * maintains `groups`.
 *
 * **Singleton.** Follows the project's `setDependencies()` /
 * `getInstance()` pattern because the wallet store is shared
 * application state configured once at bootstrap.
 */

import { ObjectId, type Collection } from 'mongodb';
import type TronWeb from 'tronweb';
import type { ICacheService, IDatabaseService, ISystemLogService, IWalletService } from '@/types';
import { SignatureService } from '../../auth/signature.service.js';
import { WalletChallengeService } from './wallet-challenge.service.js';
import type { WalletChallengeAction, IWalletChallenge } from './wallet-challenge.service.js';
import type { IWalletDocument, ILinkedWallet } from '../database/IWalletDocument.js';
import { AUTH_USERS_COLLECTION } from './auth-constants.js';

/**
 * Physical collection name for the Better Auth-keyed wallet store.
 *
 * Follows the `module_{module-id}_{collection}` convention. Renaming is
 * a breaking change for persisted records — coordinate with a migration.
 */
export const WALLETS_COLLECTION = 'module_user_wallets';

/**
 * Wallet operations the new flow supports.
 *
 * Narrower than the legacy {@link WalletChallengeAction} set — there is
 * no `refresh-verification` because Better Auth owns session freshness;
 * a wallet's only states are linked or not.
 */
export type WalletAction = Extract<WalletChallengeAction, 'link' | 'unlink' | 'set-primary'>;

/**
 * Signed-mutation input common to link / unlink / set-primary.
 *
 * `message` must equal the canonical challenge form for `(action,
 * normalizedAddress, nonce)`; `signature` must recover to the same
 * address. The service reconstructs and verifies both before mutating.
 */
export interface IWalletMutationInput {
    /** Submitted TRON address (hex or base58); normalized internally. */
    address: string;
    /** Canonical challenge message the client signed verbatim. */
    message: string;
    /** TronLink signature over `message`. */
    signature: string;
    /** Single-use nonce minted by {@link issueChallenge}. */
    nonce: string;
}

/**
 * Shape of the Better Auth user row this service denormalizes onto.
 *
 * Restricted to the field written here — BA owns the full schema. The
 * adapter maps the logical `id` to MongoDB `_id`, so writes filter by
 * `{ _id: userId }` (same boundary {@link GroupService} uses).
 */
interface IAuthUserPrimaryWallet {
    _id: string;
    primaryWallet?: string | null;
}

/**
 * Better Auth-keyed wallet linking service.
 *
 * Singleton; configured during `UserModule.init()` via
 * {@link WalletService.setDependencies}.
 */
export class WalletService implements IWalletService {
    /** Singleton instance. `null` until {@link setDependencies} runs. */
    private static instance: WalletService | null = null;

    /** `module_user_wallets` collection handle. */
    private readonly collection: Collection<IWalletDocument>;

    /** Better Auth user collection, for the denormalized `primaryWallet` write. */
    private readonly authUsers: Collection<IAuthUserPrimaryWallet>;

    /** Signature verification + address normalization. */
    private readonly signatureService: SignatureService;

    /** Single-use challenge mint/consume, scoped per (userId, action, address). */
    private readonly walletChallengeService: WalletChallengeService;

    /** Logger scoped to this service. */
    private readonly logger: ISystemLogService;

    /**
     * @param database - Database abstraction (Tier-1 collection access).
     * @param cacheService - Backs {@link WalletChallengeService} nonce storage.
     * @param logger - Derives a `component: 'wallet-service'` child.
     * @param tronWeb - Configured TronWeb for {@link SignatureService}.
     */
    private constructor(
        database: IDatabaseService,
        cacheService: ICacheService,
        logger: ISystemLogService,
        tronWeb: TronWeb
    ) {
        this.collection = database.getCollection<IWalletDocument>(WALLETS_COLLECTION);
        this.authUsers = database.getCollection<IAuthUserPrimaryWallet>(AUTH_USERS_COLLECTION);
        this.signatureService = new SignatureService(tronWeb);
        this.walletChallengeService = new WalletChallengeService(cacheService);
        this.logger = logger.child({ component: 'wallet-service' });
    }

    /**
     * Configure the singleton with its dependencies.
     *
     * Idempotent — a second call keeps the first instance, so callers
     * cannot swap dependencies after consumers have started using it.
     *
     * @param database - Database service injected by the module.
     * @param cacheService - Cache service for challenge storage.
     * @param logger - User-module child logger.
     * @param tronWeb - TronWeb instance for signature verification.
     */
    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        logger: ISystemLogService,
        tronWeb: TronWeb
    ): void {
        if (!WalletService.instance) {
            WalletService.instance = new WalletService(database, cacheService, logger, tronWeb);
        }
    }

    /**
     * Resolve the configured singleton.
     *
     * @returns The shared {@link WalletService} instance.
     * @throws {Error} When called before {@link setDependencies}.
     */
    public static getInstance(): WalletService {
        if (!WalletService.instance) {
            throw new Error('WalletService.setDependencies() must be called before getInstance().');
        }
        return WalletService.instance;
    }

    /**
     * Reset the singleton. Test-only escape hatch.
     *
     * @internal
     */
    public static resetForTests(): void {
        WalletService.instance = null;
    }

    /**
     * Create the collection indexes.
     *
     * `address` is globally unique so a wallet can belong to exactly one
     * Better Auth account; `userId` speeds the per-account list read. The
     * partial unique index on `{ userId, isPrimary }` (filtered to
     * `isPrimary: true`) enforces *at most one primary wallet per account*
     * at the database level, so a concurrent first-link race cannot leave
     * two `isPrimary: true` rows — the losing insert surfaces a duplicate-
     * key error that {@link linkWallet} recovers from by attaching the
     * wallet as non-primary.
     */
    public async createIndexes(): Promise<void> {
        await this.collection.createIndex({ address: 1 }, { unique: true });
        await this.collection.createIndex({ userId: 1 });
        await this.collection.createIndex(
            { userId: 1, isPrimary: 1 },
            { unique: true, partialFilterExpression: { isPrimary: true } }
        );
        this.logger.info('Wallet indexes created');
    }

    /**
     * List an account's linked wallets, oldest first.
     *
     * @param userId - Better Auth user id.
     * @returns Public wallet rows for the account (empty when none linked).
     */
    public async listWallets(userId: string): Promise<ILinkedWallet[]> {
        const docs = await this.collection.find({ userId }).sort({ linkedAt: 1 }).toArray();
        return docs.map(WalletService.toLinkedWallet);
    }

    /**
     * Mint a single-use challenge for a wallet operation.
     *
     * The client signs the returned `message` verbatim with TronLink and
     * submits `(message, signature, nonce)` to the matching mutation
     * within the TTL window. The nonce is scoped to the Better Auth user
     * id, the action, and the normalized address.
     *
     * @param userId - Better Auth user id.
     * @param action - Operation the challenge will gate.
     * @param address - Submitted TRON address (hex or base58).
     * @returns Challenge with nonce, canonical message, and expiry.
     * @throws {Error} When the address is malformed.
     */
    public async issueChallenge(
        userId: string,
        action: WalletAction,
        address: string
    ): Promise<IWalletChallenge> {
        const normalizedAddress = this.signatureService.normalizeAddress(address);
        return this.walletChallengeService.issue(userId, action, normalizedAddress);
    }

    /**
     * Link a wallet to the account after proving ownership.
     *
     * Verifies the challenge + signature, then attaches the wallet. The
     * first wallet an account links becomes its primary. A wallet already
     * linked to a *different* account is rejected — Better Auth identity
     * is portable, so there is no merge; the user must log into the
     * account that owns the wallet instead.
     *
     * @param userId - Better Auth user id.
     * @param input - Address, signed canonical message, signature, nonce.
     * @returns The account's wallet list after the link.
     * @throws {Error} On challenge/signature failure or cross-account conflict.
     */
    public async linkWallet(userId: string, input: IWalletMutationInput): Promise<ILinkedWallet[]> {
        const normalizedAddress = await this.verifyAction(userId, 'link', input);
        const now = new Date();

        const existing = await this.collection.findOne({ address: normalizedAddress });
        if (existing && existing.userId !== userId) {
            throw new Error('This wallet is already linked to another account.');
        }

        if (existing) {
            // Idempotent re-link by the same account — just bump usage.
            await this.collection.updateOne(
                { userId, address: normalizedAddress },
                { $set: { lastUsedAt: now } }
            );
        } else {
            const existingCount = await this.collection.countDocuments({ userId });
            const wantPrimary = existingCount === 0;
            const becamePrimary = await this.insertLinkedWallet(userId, normalizedAddress, wantPrimary, now);
            if (becamePrimary) {
                await this.setAuthPrimary(userId, normalizedAddress);
            }
        }

        this.logger.info({ userId, wallet: normalizedAddress }, 'Wallet linked to account');
        return this.listWallets(userId);
    }

    /**
     * Insert a new wallet row, recovering from the two duplicate-key races
     * the unique indexes can surface so a concurrent link never leaks a raw
     * E11000 out of the API.
     *
     * - **Address unique index** — the same wallet was linked concurrently
     *   between this method's caller `findOne` pre-check and the insert. If
     *   it now belongs to another account, reject with the friendly
     *   cross-account conflict; if to this account, treat as idempotent and
     *   bump usage.
     * - **Partial `{ userId, isPrimary: true }` index** — a concurrent
     *   first-link already claimed primary. Re-insert this wallet as
     *   non-primary so the at-most-one-primary invariant holds.
     *
     * @param userId - Better Auth user id.
     * @param address - Normalized base58 address.
     * @param wantPrimary - Whether this would be the account's first (primary) wallet.
     * @param now - Shared timestamp for linkedAt/lastUsedAt.
     * @returns Whether the row was ultimately stored as the account's primary.
     */
    private async insertLinkedWallet(
        userId: string,
        address: string,
        wantPrimary: boolean,
        now: Date
    ): Promise<boolean> {
        try {
            await this.collection.insertOne({
                _id: new ObjectId(),
                userId,
                address,
                isPrimary: wantPrimary,
                linkedAt: now,
                lastUsedAt: now
            });
            return wantPrimary;
        } catch (error) {
            if (!isDuplicateKeyError(error)) {
                throw error;
            }
            const dup = await this.collection.findOne({ address });
            if (dup) {
                // Address unique index: the same wallet was inserted
                // concurrently. Mirror the caller's pre-check semantics.
                if (dup.userId !== userId) {
                    throw new Error('This wallet is already linked to another account.');
                }
                await this.collection.updateOne(
                    { userId, address },
                    { $set: { lastUsedAt: now } }
                );
                return dup.isPrimary;
            }
            // The address is absent, so the conflict was the partial
            // primary index — another concurrent first-link already became
            // primary. Attach this wallet as non-primary.
            await this.collection.insertOne({
                _id: new ObjectId(),
                userId,
                address,
                isPrimary: false,
                linkedAt: now,
                lastUsedAt: now
            });
            return false;
        }
    }

    /**
     * Unlink a wallet from the account.
     *
     * Requires a fresh `unlink` challenge + signature over the target
     * address. When the removed wallet was primary, the most recently
     * used remaining wallet is promoted; if none remain the denormalized
     * `primaryWallet` is cleared.
     *
     * @param userId - Better Auth user id.
     * @param input - Address, signed canonical message, signature, nonce.
     * @returns The account's wallet list after the unlink.
     * @throws {Error} On challenge/signature failure or when not linked.
     */
    public async unlinkWallet(userId: string, input: IWalletMutationInput): Promise<ILinkedWallet[]> {
        const normalizedAddress = await this.verifyAction(userId, 'unlink', input);

        const target = await this.collection.findOne({ userId, address: normalizedAddress });
        if (!target) {
            throw new Error('Wallet is not linked to this account.');
        }

        await this.collection.deleteOne({ userId, address: normalizedAddress });

        // Recompute the primary from the post-deletion state on every
        // unlink rather than trusting the pre-deletion `target.isPrimary`.
        // Two concurrent unlinks (primary + non-primary) could otherwise
        // both read stale `isPrimary` flags: the non-primary request, having
        // seen `isPrimary === false` before the primary was deleted and
        // promoted, would delete the freshly-promoted wallet yet skip the
        // promotion block — stranding `authUsers.primaryWallet` on an
        // already-deleted address. Re-reading here closes that window and
        // also self-heals a collection that has ended up with no primary.
        const remaining = await this.collection.find({ userId }).sort({ lastUsedAt: -1 }).toArray();
        if (remaining.length === 0) {
            await this.setAuthPrimary(userId, null);
        } else if (!remaining.some(w => w.isPrimary)) {
            const next = remaining[0];
            await this.collection.updateOne(
                { userId, address: next.address },
                { $set: { isPrimary: true } }
            );
            await this.setAuthPrimary(userId, next.address);
        }

        this.logger.info({ userId, wallet: normalizedAddress }, 'Wallet unlinked from account');
        return this.listWallets(userId);
    }

    /**
     * Set an already-linked wallet as the account's primary.
     *
     * Step-up authentication: a fresh `set-primary` challenge + signature
     * is required because the primary wallet drives downstream
     * attribution and a captured session cookie alone should not steer
     * it. The wallet must already be linked.
     *
     * @param userId - Better Auth user id.
     * @param input - Address, signed canonical message, signature, nonce.
     * @returns The account's wallet list after the change.
     * @throws {Error} On challenge/signature failure or when not linked.
     */
    public async setPrimaryWallet(userId: string, input: IWalletMutationInput): Promise<ILinkedWallet[]> {
        const normalizedAddress = await this.verifyAction(userId, 'set-primary', input);

        const target = await this.collection.findOne({ userId, address: normalizedAddress });
        if (!target) {
            throw new Error('Wallet is not linked to this account.');
        }

        const now = new Date();
        await this.collection.updateMany({ userId }, { $set: { isPrimary: false } });
        await this.collection.updateOne(
            { userId, address: normalizedAddress },
            { $set: { isPrimary: true, lastUsedAt: now } }
        );
        await this.setAuthPrimary(userId, normalizedAddress);

        this.logger.info({ userId, wallet: normalizedAddress }, 'Primary wallet updated');
        return this.listWallets(userId);
    }

    /**
     * Verify a wallet challenge and signature, returning the normalized address.
     *
     * Mirrors the legacy `verifyWalletAction` order so a malformed message
     * cannot waste the user's nonce: normalize, assert the canonical
     * message form, consume the nonce atomically, then verify the
     * signature recovers to the same address.
     *
     * @param userId - Better Auth user id the nonce is scoped to.
     * @param action - Action the nonce was minted for.
     * @param input - Address, message, signature, nonce.
     * @returns Normalized base58 address.
     * @throws {Error} On any mismatch — caller handles only the success case.
     */
    private async verifyAction(
        userId: string,
        action: WalletAction,
        input: IWalletMutationInput
    ): Promise<string> {
        const normalizedAddress = this.signatureService.normalizeAddress(input.address);

        if (!input.nonce) {
            throw new Error('Wallet challenge nonce is required.');
        }
        const expected = WalletChallengeService.buildMessage(action, normalizedAddress, input.nonce);
        if (input.message !== expected) {
            throw new Error('Signed message does not match the canonical challenge form.');
        }
        const consumed = await this.walletChallengeService.consume(userId, action, normalizedAddress, input.nonce);
        if (!consumed) {
            throw new Error('Wallet challenge expired or already used. Request a new challenge.');
        }

        const recovered = await this.signatureService.verifyMessage(
            normalizedAddress,
            input.message,
            input.signature
        );
        if (recovered !== normalizedAddress) {
            throw new Error('Signature address does not match submitted address.');
        }

        return normalizedAddress;
    }

    /**
     * Write the denormalized primary wallet onto the Better Auth user row.
     *
     * `null` clears it (last wallet unlinked). The session augmentation in
     * the auth facade reads this field, so the primary surfaces without
     * touching this collection.
     *
     * @param userId - Better Auth user id (BA `_id`).
     * @param address - Primary address, or `null` to clear.
     */
    private async setAuthPrimary(userId: string, address: string | null): Promise<void> {
        await this.authUsers.updateOne({ _id: userId }, { $set: { primaryWallet: address } });
    }

    /**
     * Project a stored wallet document to its public wire shape.
     *
     * @param doc - Stored wallet document.
     * @returns Public {@link ILinkedWallet} without Mongo/internal fields.
     */
    private static toLinkedWallet(doc: IWalletDocument): ILinkedWallet {
        return {
            address: doc.address,
            isPrimary: doc.isPrimary,
            linkedAt: doc.linkedAt,
            lastUsedAt: doc.lastUsedAt
        };
    }
}

/**
 * True for a MongoDB duplicate-key (E11000) error, regardless of which
 * unique index raised it. Kept structural (a `code === 11000` check rather
 * than an `instanceof`) so a driver-version change in the error class
 * doesn't silently break detection.
 *
 * @param error - Caught error of unknown type.
 * @returns Whether it is a duplicate-key violation.
 */
function isDuplicateKeyError(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: unknown }).code === 11000
    );
}
