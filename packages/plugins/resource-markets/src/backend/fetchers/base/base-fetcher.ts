import { ZodError } from 'zod';
import type { IPluginContext } from '@tronrelic/types';
import type { MarketSnapshot } from '../../../shared/types/market-snapshot.dto.js';
import { MarketSnapshotSchema } from '../../../shared/types/market-snapshot.dto.js';
import type { IMarketFetcher } from '../types.js';

export interface MarketFetcherOptions {
    name: string;
    guid: string;
    timeoutMs?: number;
}

/**
 * Base class for market fetchers that pull data from third-party energy markets.
 *
 * Fetchers receive IPluginContext via constructor for dependency injection.
 * Subclasses implement pull() to fetch raw data from upstream APIs.
 */
export abstract class BaseMarketFetcher implements IMarketFetcher {
    readonly name: string;
    readonly guid: string;
    readonly timeoutMs: number;

    protected constructor(
        protected readonly context: IPluginContext,
        options: MarketFetcherOptions
    ) {
        this.name = options.name;
        this.guid = options.guid;
        this.timeoutMs = options.timeoutMs ?? 10_000;
    }

    /**
     * Fetches raw market data from upstream API.
     *
     * Subclasses implement this method to pull data in provider-specific formats.
     * The base class handles validation, error handling, and inactivity detection.
     *
     * @returns Promise resolving to raw data (validated by transform()) or null if unavailable
     */
    abstract pull(): Promise<unknown>;

    /**
     * Validates and transforms raw API response into normalized MarketSnapshot.
     *
     * @param raw - Raw API response data
     * @returns Validated MarketSnapshot or null if validation fails
     */
    protected transform(raw: unknown): MarketSnapshot | null {
        const parsed = MarketSnapshotSchema.safeParse(raw);
        if (!parsed.success) {
            throw parsed.error;
        }
        return parsed.data;
    }

    /**
     * Checks if an error indicates the market should be marked as inactive.
     *
     * Markets are deactivated when:
     * - SSL certificates expire or are invalid
     * - DNS resolution fails (domain gone)
     * - Certificate errors persist
     *
     * @param error - The error to check
     * @returns True if market should be marked inactive
     */
    protected shouldDeactivateMarket(error: unknown): boolean {
        const errorCode = (error as { code?: string })?.code;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // SSL certificate errors indicate the site is not properly maintained
        if (
            errorCode === 'CERT_HAS_EXPIRED' ||
            errorCode === 'CERT_NOT_YET_VALID' ||
            errorCode === 'DEPTH_ZERO_SELF_SIGNED_CERT'
        ) {
            return true;
        }

        // DNS failures indicate the domain is gone
        if (errorCode === 'ENOTFOUND') {
            return true;
        }

        // Check message patterns
        if (errorMessage.includes('certificate') && errorMessage.includes('expired')) {
            return true;
        }

        return false;
    }

    /**
     * Fetches market data with error handling and inactivity detection.
     *
     * This is the main entry point called by the market aggregator.
     * It orchestrates pulling, validation, error handling, and inactivity marking.
     *
     * @returns Promise resolving to MarketSnapshot or null if fetch fails
     */
    async fetch(): Promise<MarketSnapshot | null> {
        try {
            const raw = await this.pull();
            if (!raw) {
                return null;
            }
            const normalized = this.transform(raw);
            if (!normalized) {
                return null;
            }
            return normalized;
        } catch (error) {
            this.handleError(error);

            // If the error indicates the market should be deactivated, return an inactive snapshot
            if (this.shouldDeactivateMarket(error)) {
                this.context.logger.warn(
                    { error, fetcher: this.name, guid: this.guid },
                    'Market will be marked as inactive due to critical error'
                );
                return {
                    guid: this.guid,
                    name: this.name,
                    priority: 999,
                    energy: { total: 0, available: 0 },
                    isActive: false
                } as MarketSnapshot;
            }

            return null;
        }
    }

    /**
     * Handles errors during fetch operations with appropriate logging.
     *
     * @param error - The error to handle
     */
    protected handleError(error: unknown) {
        if (error instanceof ZodError) {
            this.context.logger.warn({ error, fetcher: this.name }, 'Market snapshot validation failed');
        } else {
            this.context.logger.error({ error, fetcher: this.name }, 'Market fetch failed');
        }
    }
}
