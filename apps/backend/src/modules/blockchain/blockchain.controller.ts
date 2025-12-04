import type { Request, Response } from 'express';
import { BlockchainService } from './blockchain.service.js';

/**
 * HTTP controller for blockchain-related API endpoints.
 *
 * Provides REST endpoints for querying transaction data, triggering sync operations,
 * and retrieving analytics timeseries. All methods delegate business logic to
 * BlockchainService and handle HTTP-specific concerns like request parsing and
 * response formatting.
 */
export class BlockchainController {
    private readonly service: BlockchainService;

    constructor() {
        this.service = BlockchainService.getInstance();
    }

    /**
     * GET /api/blockchain/latest
     *
     * Retrieves the most recently processed block with full statistics.
     * Used for SSR rendering of the CurrentBlock component on the homepage.
     * Returns null if no blocks have been processed yet.
     *
     * @param _req - Express request (no parameters required)
     * @param res - Express response containing latest block or null
     */
    latestBlock = async (_req: Request, res: Response) => {
        const block = await this.service.getLatestBlock();
        res.json({ success: true, block });
    };

    /**
     * GET /api/blockchain/transactions/latest?limit=50
     *
     * Retrieves the most recent transactions from the database, sorted by timestamp
     * descending. Useful for displaying recent blockchain activity in UI feeds.
     *
     * @param req - Express request with optional `limit` query parameter (max 200)
     * @param res - Express response containing transaction array
     */
    latestTransactions = async (req: Request, res: Response) => {
        const limit = Number(req.query.limit ?? 50);
        const transactions = await this.service.getLatestTransactions(Math.min(limit, 200));
        res.json({ success: true, transactions });
    };

    /**
     * POST /api/blockchain/sync
     *
     * Manually triggers a blockchain sync cycle to queue new blocks for processing.
     * Primarily used for debugging or forcing sync after configuration changes.
     *
     * @param _req - Express request (no parameters required)
     * @param res - Express response with success indicator
     */
    triggerSync = async (_req: Request, res: Response) => {
        await this.service.syncLatestBlocks();
        res.json({ success: true });
    };

    /**
     * GET /api/blockchain/transactions/timeseries?days=7
     *
     * Retrieves aggregated transaction statistics grouped by time windows for charting.
     * Automatically adjusts grouping granularity based on requested time range:
     * - 1 day: hourly buckets (24 points)
     * - 7 days: hourly buckets (168 points)
     * - 30+ days: 4-hour windows (180 points for 30 days)
     *
     * @param req - Express request with `days` query parameter (min 1, max 90)
     * @param res - Express response containing timeseries data points
     */
    transactionTimeseries = async (req: Request, res: Response) => {
        const days = Number(req.query.days ?? 7);

        if (!Number.isFinite(days) || days <= 0) {
            res.status(400).json({
                success: false,
                error: 'Invalid days parameter. Must be a positive number.'
            });
            return;
        }

        const data = await this.service.getTransactionTimeseries(days);
        res.json({ success: true, data });
    };
}
