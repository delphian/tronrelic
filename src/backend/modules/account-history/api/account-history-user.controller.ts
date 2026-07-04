/**
 * @fileoverview User-facing HTTP layer for account-history download progress.
 *
 * The admin API exposes the whole tracked set; a signed-in user must see only
 * the backfill status of the wallets they personally verified. This controller
 * enforces that ownership boundary: it resolves the caller's verified wallets
 * through the identity module's published `'wallets'` service and returns
 * progress for only those addresses. Knowing an address is never authorization —
 * the response is always the intersection of "addresses the caller owns" and
 * "addresses currently tracked", so one user can never read another's status.
 */

import type { Request, Response } from 'express';
import type {
    FlowGranularity,
    IAccountHistoryService,
    IServiceRegistry,
    ISystemLogService,
    IWalletService
} from '@/types';

/**
 * The granularity query values the flow endpoint accepts, guarding the string
 * off the wire before it reaches the service. A closed set means an unknown or
 * absent `?granularity=` falls back to the monthly view rather than reaching the
 * SQL layer with an unvalidated value.
 */
const FLOW_GRANULARITIES: readonly FlowGranularity[] = ['month', 'week', 'day'];

/**
 * Minimal structural view of the optional `'address-labels'` registry service
 * (published by the trp-address-labels plugin). Core cannot depend on a
 * plugin's types package — that would invert the dependency direction — so the
 * controller declares only the one method it consumes and duck-types against
 * whatever implementation the registry currently holds.
 */
interface IAddressLabelResolver {
    /**
     * Batch-resolve human-friendly labels for many addresses; unlabeled
     * addresses are omitted from the returned map.
     *
     * @param addresses - TRON base58 addresses to resolve.
     * @returns Map of address → resolved label record.
     */
    resolveMany(addresses: string[]): Promise<Map<string, { label: string }>>;
}

/**
 * Login-gated controller exposing a user's own wallet backfill progress.
 */
export class AccountHistoryUserController {
    /**
     * @param service - The central account-history service (progress reads).
     * @param serviceRegistry - Used to resolve the identity `'wallets'` service
     *   at request time, the only sanctioned path to the caller's verified
     *   addresses (identity owns that collection).
     * @param logger - Scoped logger for handler-level error reporting.
     */
    constructor(
        private readonly service: IAccountHistoryService,
        private readonly serviceRegistry: IServiceRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET /me/progress — download progress for the caller's own verified wallets.
     *
     * `requireLogin` has already populated `req.userId`. The handler resolves the
     * caller's verified addresses through `'wallets'`, then asks the service for
     * progress on only those — addresses the caller does not own are never
     * queried. Degrades to an empty list when identity is unavailable so the
     * profile page still renders.
     *
     * @param req - Express request; `req.userId` is the resolved Better Auth user id.
     * @param res - Express response; emits `{ progress }`.
     */
    getMyProgress = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }

            const wallets = this.serviceRegistry.get<IWalletService>('wallets');
            if (!wallets) {
                res.json({ progress: [] });
                return;
            }

            const owned = await wallets.listWallets(userId);
            const progress = await this.service.getProgressFor(owned.map((wallet) => wallet.address));
            res.json({ progress });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read wallet history progress');
            res.status(500).json({
                error: 'Failed to read history progress',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    /**
     * GET /me/wallets/:address/summary — the batched activity summary (heatmap,
     * stats, resources, flow, counterparties) for ONE wallet the caller owns.
     *
     * Ownership is checked before any history read: a `:address` the caller has
     * not verified returns 404, never the summary — the same "knowing an id is not
     * authorization" rule the progress route follows, surfaced as not-found so the
     * endpoint never confirms whether an unowned address is tracked.
     *
     * @param req - Express request; `req.userId` is set by `requireLogin`, `:address` is the wallet.
     * @param res - Express response; emits `{ summary }`.
     */
    getMyWalletSummary = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }

            const address = String(req.params.address ?? '').trim();
            if (!(await this.ownsWallet(userId, address))) {
                res.status(404).json({ error: 'Wallet not found' });
                return;
            }

            const summary = await this.service.getWalletSummary(address);
            const labels = await this.resolveLabels(
                summary.counterparties.map((counterparty) => counterparty.address)
            );
            res.json({ summary, labels });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read wallet summary');
            res.status(500).json({
                error: 'Failed to read wallet summary',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    /**
     * GET /me/wallets/:address/flow — inflow/outflow buckets for ONE wallet the
     * caller owns, at the `?granularity=` resolution (month/week/day). Split from
     * the summary so the profile chart's precision selector re-buckets without
     * re-fetching the whole summary. Same ownership gate as the summary route:
     * an unowned `:address` returns 404, never the series. An unrecognized or
     * missing granularity degrades to the monthly view rather than erroring.
     *
     * @param req - Express request; `req.userId` from `requireLogin`, `:address` the wallet, `granularity` query param.
     * @param res - Express response; emits `{ flow }`.
     */
    getMyWalletFlow = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }

            const address = String(req.params.address ?? '').trim();
            if (!(await this.ownsWallet(userId, address))) {
                res.status(404).json({ error: 'Wallet not found' });
                return;
            }

            const requested = String(req.query.granularity ?? '') as FlowGranularity;
            const granularity: FlowGranularity = FLOW_GRANULARITIES.includes(requested) ? requested : 'month';
            const flow = await this.service.getWalletFlow(address, granularity);
            res.json({ flow });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read wallet flow');
            res.status(500).json({
                error: 'Failed to read wallet flow',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    /**
     * GET /me/wallets/:address/transactions — a page of the decoded transaction
     * feed for ONE wallet the caller owns. Same ownership gate as the summary:
     * unowned addresses 404. `limit`/`offset` come from the query string and are
     * clamped by the service.
     *
     * @param req - Express request; `req.userId` from `requireLogin`, `:address` the wallet, `limit`/`offset` query params.
     * @param res - Express response; emits an `IAccountTransactionPage`.
     */
    getMyWalletTransactions = async (req: Request, res: Response): Promise<void> => {
        try {
            const userId = req.userId;
            if (!userId) {
                res.status(401).json({ error: 'Authentication required' });
                return;
            }

            const address = String(req.params.address ?? '').trim();
            if (!(await this.ownsWallet(userId, address))) {
                res.status(404).json({ error: 'Wallet not found' });
                return;
            }

            const rawLimit = req.query.limit !== undefined ? Number(req.query.limit) : undefined;
            const rawOffset = req.query.offset !== undefined ? Number(req.query.offset) : undefined;
            const limit = Number.isNaN(rawLimit) ? undefined : rawLimit;
            const offset = Number.isNaN(rawOffset) ? undefined : rawOffset;
            const page = await this.service.getTransactions({ address, limit, offset });
            const labels = await this.resolveLabels(
                page.transactions.flatMap((tx) => [tx.from?.address ?? '', tx.to?.address ?? ''])
            );
            res.json({ ...page, labels });
        } catch (error) {
            this.logger.error({ error }, 'Failed to read wallet transactions');
            res.status(500).json({
                error: 'Failed to read wallet transactions',
                message: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    };

    /**
     * Resolve human-friendly labels for a set of addresses through the optional
     * `'address-labels'` registry service. The wallet detail surfaces render
     * counterparty addresses; labeling known entities (exchanges, pools) makes
     * the feed legible. Resolution is best-effort by design — the plugin may be
     * disabled, so any failure degrades to an empty map and the UI falls back
     * to truncated addresses rather than the request failing.
     *
     * @param addresses - Candidate base58 addresses (blanks and duplicates tolerated).
     * @returns Plain address → label record, empty when unavailable.
     */
    private async resolveLabels(addresses: string[]): Promise<Record<string, string>> {
        let labels: Record<string, string> = {};
        try {
            const resolver = this.serviceRegistry.get<IAddressLabelResolver>('address-labels');
            const unique = [...new Set(addresses.filter((address) => address.length > 0))];
            if (resolver && unique.length > 0) {
                const resolved = await resolver.resolveMany(unique);
                labels = Object.fromEntries(
                    [...resolved.entries()].map(([address, entry]) => [address, entry.label])
                );
            }
        } catch (error) {
            this.logger.warn({ error }, 'Address label resolution failed; returning unlabeled addresses');
            labels = {};
        }
        return labels;
    }

    /**
     * Confirm the caller verified the given wallet. Resolves the identity
     * `'wallets'` service at request time (the only sanctioned path to a user's
     * verified addresses) and tests membership. Returns false when identity is
     * unavailable or the address is empty, so a missing service degrades to
     * "not owned" — fail-closed, never fail-open.
     *
     * @param userId - The resolved Better Auth user id.
     * @param address - The base58 wallet the caller is asking about.
     * @returns True only when the caller owns the address.
     */
    private async ownsWallet(userId: string, address: string): Promise<boolean> {
        if (!address) {
            return false;
        }
        const wallets = this.serviceRegistry.get<IWalletService>('wallets');
        if (!wallets) {
            return false;
        }
        const owned = await wallets.listWallets(userId);
        const ownsIt = owned.some((wallet) => wallet.address === address);
        return ownsIt;
    }
}
