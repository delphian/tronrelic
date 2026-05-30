/**
 * @fileoverview Server-issued single-use challenges for wallet operations.
 *
 * Replaces the legacy client-supplied timestamp + 5-minute replay window with
 * a server-minted nonce bound to (userId, action, normalizedAddress). The
 * nonce expires after 60 seconds and is consumed atomically on verification,
 * so a captured signed message cannot be replayed within the window and the
 * client cannot manipulate the freshness signal.
 */

import { randomBytes } from 'node:crypto';
import type { ICacheService } from '@/types';

/**
 * Wallet operations that require a fresh server-issued challenge.
 *
 * Each action gets its own nonce scope so a challenge minted for one
 * operation cannot be replayed against another (e.g. an `unlink` nonce
 * cannot be consumed by `set-primary`).
 *
 * `'refresh-verification'` is the freshness-pump action — consumed when
 * a user with stale `verifiedAt` re-signs to bring an existing wallet
 * back into the freshness window. It mints the same nonce shape as the
 * other actions but is rejected by `linkWallet` / `unlinkWallet` /
 * `setPrimaryWallet` so it cannot be replayed against those side-effects.
 */
export type WalletChallengeAction = 'link' | 'unlink' | 'set-primary' | 'refresh-verification';

const ALLOWED_ACTIONS: ReadonlySet<WalletChallengeAction> = new Set<WalletChallengeAction>([
    'link',
    'unlink',
    'set-primary',
    'refresh-verification'
]);

/**
 * Result of issuing a wallet challenge.
 *
 * The client signs `message` verbatim with TronLink and submits the
 * signature plus `nonce` back to the matching wallet endpoint within the
 * TTL window. `expiresAt` is informational so the UI can warn users when a
 * challenge is about to lapse.
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
 * Issues and consumes single-use wallet operation challenges.
 *
 * Internal utility used by UserService — not a singleton, not registered
 * on the service registry. Constructed once inside UserService with the
 * shared cache service. Stateless beyond the cache backing store.
 */
export class WalletChallengeService {
    /** TTL in seconds. Long enough for a TronLink popup, short enough to make
     * signed-message capture impractical. */
    static readonly TTL_SECONDS = 60;
    static readonly KEY_PREFIX = 'user:wallet:challenge:';
    /** 24 random bytes = 48 hex chars = 192 bits of entropy. */
    static readonly NONCE_BYTES = 24;

    /**
     * @param cacheService - Redis-backed cache used for nonce storage. Single-use
     *                      semantics rely on `del()` returning 1 only for the
     *                      winning caller in a race.
     */
    constructor(private readonly cacheService: ICacheService) {}

    /**
     * Mint a new challenge for the (userId, action, address) tuple.
     *
     * Overwrites any previous unconsumed challenge for the same tuple — the
     * client only cares about its most recent nonce, and overwriting prevents
     * stale entries from lingering after retries.
     *
     * @param userId - UUID of the caller; nonces are isolated per user
     * @param action - Wallet operation the challenge gates
     * @param normalizedAddress - Base58 TRON address, already normalized by the caller
     * @returns Nonce, canonical message to sign, and expiry timestamp
     * @throws Error when action is not a recognized wallet operation
     */
    async issue(
        userId: string,
        action: WalletChallengeAction,
        normalizedAddress: string
    ): Promise<IWalletChallenge> {
        if (!ALLOWED_ACTIONS.has(action)) {
            throw new Error(`Unknown wallet challenge action: ${action}`);
        }

        const nonce = randomBytes(WalletChallengeService.NONCE_BYTES).toString('hex');
        const message = WalletChallengeService.buildMessage(action, normalizedAddress, nonce);
        const key = WalletChallengeService.cacheKey(userId, action, normalizedAddress);

        await this.cacheService.set(key, nonce, WalletChallengeService.TTL_SECONDS);

        return {
            nonce,
            message,
            expiresAt: Date.now() + WalletChallengeService.TTL_SECONDS * 1000
        };
    }

    /**
     * Consume the challenge atomically.
     *
     * Returns true exactly once per issued nonce. `del()` returns the number
     * of keys actually removed by this call, so a concurrent caller racing
     * on the same nonce sees 0 and loses. Returns false for missing, expired,
     * or mismatched nonces.
     *
     * @param userId - UUID that issued the nonce
     * @param action - Action that minted the nonce; must match the original
     * @param normalizedAddress - Address tied to the nonce
     * @param nonce - Nonce value the client submitted
     * @returns True if the nonce was valid and successfully consumed
     */
    async consume(
        userId: string,
        action: WalletChallengeAction,
        normalizedAddress: string,
        nonce: string
    ): Promise<boolean> {
        if (!ALLOWED_ACTIONS.has(action) || !nonce) {
            return false;
        }

        const key = WalletChallengeService.cacheKey(userId, action, normalizedAddress);
        const stored = await this.cacheService.get<string>(key);
        if (stored !== nonce) {
            return false;
        }

        const removed = await this.cacheService.del(key);
        return removed === 1;
    }

    /**
     * Build the canonical message the client must sign.
     *
     * Exposed statically so the controller and tests can derive the expected
     * message without duplicating the format string.
     */
    static buildMessage(
        action: WalletChallengeAction,
        normalizedAddress: string,
        nonce: string
    ): string {
        return `TronRelic ${action} wallet ${normalizedAddress} (nonce ${nonce})`;
    }

    private static cacheKey(
        userId: string,
        action: WalletChallengeAction,
        normalizedAddress: string
    ): string {
        return `${WalletChallengeService.KEY_PREFIX}${userId}:${action}:${normalizedAddress}`;
    }
}
