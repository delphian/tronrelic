/**
 * @fileoverview Admin HTTP layer for the per-wallet balance-chart range override.
 *
 * The balance-over-time chart defaults every wallet to a trailing year; an
 * operator can widen a specific wallet to its full reconstructable history.
 * The override is stored in the identity module's central `'user-settings'`
 * store (namespace `'valuation'`, keyed by wallet address) rather than owned
 * here, so this controller validates input, confirms the account exists and
 * actually owns the wallet (via identity's `'accounts'`/`'wallets'` services),
 * and delegates — `requireAdmin` is applied at mount.
 */

import type { Request, Response } from 'express';
import type { IServiceRegistry, IUserSettingsService, IAccountDirectoryService, IWalletService, ISystemLogService } from '@/types';
import type { BalanceRangeSetting } from '../services/valuation.service.js';

/** Base58 TRON address — same pattern the account-history module validates against. */
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** Namespace under which the override is stored in `'user-settings'` (mirrors valuation.service.ts). */
const BALANCE_RANGE_NAMESPACE = 'valuation';

/** The only two accepted values for a balance-range override. */
const VALID_RANGES: readonly BalanceRangeSetting[] = ['1y', 'all'];

/**
 * Signals "the requested resource doesn't exist" distinctly from a malformed
 * request, so the handlers can 404 rather than 400 or 500 — a mistyped
 * `userId` must never silently write a dangling override nobody reads.
 */
class NotFoundError extends Error {}

/**
 * Admin controller reading and writing one wallet's balance-chart range
 * override. Trusted-path only — writes go through `IUserSettingsService.set`/
 * `delete` directly, never the self-service `/api/user/settings` surface, so a
 * user cannot widen their own window.
 */
export class ValuationAdminController {
    /**
     * @param serviceRegistry - Resolves `'user-settings'` at request time.
     * @param logger - Scoped logger for handler-level error reporting.
     */
    constructor(
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /users/:userId/wallets/:address/balance-range — the effective range
     * for one user's wallet (the stored override, or the `'1y'` default).
     *
     * @param req - Params carry `userId` and `address`.
     * @param res - Emits `{ range }`.
     */
    getBalanceRange = async (req: Request, res: Response): Promise<void> => {
        try {
            const { userId, address } = this.parseParams(req);
            await this.verifyOwnership(userId, address);
            const userSettings = this.requireUserSettings();
            const stored = await userSettings.get<BalanceRangeSetting>(userId, BALANCE_RANGE_NAMESPACE, address);
            res.json({ range: stored ?? '1y' });
        } catch (error) {
            this.fail(res, this.statusFor(error), 'Failed to read balance-range override', error);
        }
    };

    /**
     * PATCH /users/:userId/wallets/:address/balance-range — set or clear the
     * override. Setting `'1y'` (the default) deletes the row rather than storing
     * a redundant value; setting `'all'` upserts it.
     *
     * @param req - Params carry `userId`/`address`; body carries `{ range }`.
     * @param res - Emits the effective `{ range }` after the write.
     */
    setBalanceRange = async (req: Request, res: Response): Promise<void> => {
        try {
            const { userId, address } = this.parseParams(req);
            const range = req.body?.range;
            if (!VALID_RANGES.includes(range)) {
                res.status(400).json({ error: `range must be one of: ${VALID_RANGES.join(', ')}` });
                return;
            }
            await this.verifyOwnership(userId, address);
            const userSettings = this.requireUserSettings();
            if (range === '1y') {
                await userSettings.delete(userId, BALANCE_RANGE_NAMESPACE, address);
            } else {
                await userSettings.set<BalanceRangeSetting>(userId, BALANCE_RANGE_NAMESPACE, address, range);
            }
            res.json({ range });
        } catch (error) {
            this.fail(res, this.statusFor(error), 'Failed to update balance-range override', error);
        }
    };

    /**
     * Validate and extract the `userId`/`address` path params shared by both
     * handlers.
     *
     * @param req - Express request carrying the params.
     * @returns The validated, trimmed params.
     * @throws {RangeError} When either param is missing or malformed.
     */
    private parseParams(req: Request): { userId: string; address: string } {
        const userId = String(req.params.userId ?? '').trim();
        const address = String(req.params.address ?? '').trim();
        if (!userId) {
            throw new RangeError('userId is required');
        }
        if (!TRON_ADDRESS_PATTERN.test(address)) {
            throw new RangeError('address must be a base58 TRON address (T...)');
        }
        return { userId, address };
    }

    /**
     * Confirm the path params name a real account that actually owns the given
     * wallet, so a mistyped `userId` 404s instead of silently writing an override
     * nobody's portfolio read will ever resolve.
     *
     * @param userId - Better Auth id from the path.
     * @param address - Wallet address from the path.
     * @throws {NotFoundError} When the account doesn't exist or doesn't own the wallet.
     * @throws {Error} When identity's `'accounts'`/`'wallets'` services are unavailable.
     */
    private async verifyOwnership(userId: string, address: string): Promise<void> {
        const accounts = this.serviceRegistry.get<IAccountDirectoryService>('accounts');
        const wallets = this.serviceRegistry.get<IWalletService>('wallets');
        if (!accounts || !wallets) {
            throw new Error("'accounts'/'wallets' services are unavailable");
        }
        const [account, owned] = await Promise.all([
            accounts.getAccount(userId),
            wallets.listWallets(userId)
        ]);
        if (!account) {
            throw new NotFoundError(`No account found for userId ${userId}`);
        }
        if (!owned.some((wallet) => wallet.address === address)) {
            throw new NotFoundError(`Wallet ${address} is not linked to userId ${userId}`);
        }
    }

    /**
     * Resolve `'user-settings'`, throwing when identity has not published it —
     * an admin write with nowhere to land must fail loudly, not silently no-op.
     *
     * @returns The published user-settings service.
     * @throws {Error} When the service is unavailable.
     */
    private requireUserSettings(): IUserSettingsService {
        const userSettings = this.serviceRegistry.get<IUserSettingsService>('user-settings');
        if (!userSettings) {
            throw new Error("'user-settings' service is unavailable");
        }
        return userSettings;
    }

    /**
     * Map a caught error to its HTTP status: malformed input is a 400, an
     * unresolvable account/wallet is a 404, anything else is a 500.
     *
     * @param error - The caught error.
     * @returns The status code to respond with.
     */
    private statusFor(error: unknown): number {
        if (error instanceof RangeError) {
            return 400;
        }
        if (error instanceof NotFoundError) {
            return 404;
        }
        return 500;
    }

    /**
     * Log and emit a uniform error response.
     *
     * @param res - The response to write.
     * @param status - HTTP status.
     * @param error - Operator-facing summary.
     * @param cause - The underlying error.
     */
    private fail(res: Response, status: number, error: string, cause: unknown): void {
        this.logger.error({ error: cause }, error);
        res.status(status).json({ error, message: cause instanceof Error ? cause.message : 'Unknown error' });
    }
}
