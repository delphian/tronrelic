import { ZodError } from 'zod';
import type { ISystemLogService } from '@tronrelic/types';
import type { MarketSnapshot } from '../../dtos/market-snapshot.dto.js';
import { MarketSnapshotSchema } from '../../dtos/market-snapshot.dto.js';
import type { MarketFetcher, MarketFetcherContext } from '../types.js';

export interface MarketFetcherOptions {
  name: string;
  guid: string;
  timeoutMs?: number;
}

export abstract class BaseMarketFetcher implements MarketFetcher {
  readonly name: string;
  readonly guid: string;
  readonly timeoutMs: number;

  protected constructor(options: MarketFetcherOptions) {
    this.name = options.name;
    this.guid = options.guid;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  abstract pull(context: MarketFetcherContext): Promise<unknown>;

  protected transform(raw: unknown, _context: MarketFetcherContext): MarketSnapshot | null {
    const parsed = MarketSnapshotSchema.safeParse(raw);
    if (!parsed.success) {
      throw parsed.error;
    }
    return parsed.data;
  }

  /**
     * Checks if an error indicates the market should be marked as inactive.
     *
     * @param error - The error to check
     * @returns True if market should be marked inactive (e.g., SSL cert expired, DNS failure)
     */
    protected shouldDeactivateMarket(error: unknown): boolean {
        const errorCode = (error as { code?: string })?.code;
        const errorMessage = error instanceof Error ? error.message : String(error);

        // SSL certificate errors indicate the site is not properly maintained
        if (errorCode === 'CERT_HAS_EXPIRED' ||
            errorCode === 'CERT_NOT_YET_VALID' ||
            errorCode === 'DEPTH_ZERO_SELF_SIGNED_CERT') {
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

    async fetch(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
        try {
            const raw = await this.pull(context);
            if (!raw) {
                return null;
            }
            const normalized = this.transform(raw, context);
            if (!normalized) {
                return null;
            }
            return normalized;
        } catch (error) {
            this.handleError(error, context.logger);

            // If the error indicates the market should be deactivated, return an inactive snapshot
            if (this.shouldDeactivateMarket(error)) {
                context.logger.warn(
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

    protected handleError(error: unknown, logger: ISystemLogService) {
        if (error instanceof ZodError) {
            logger.warn({ error, fetcher: this.name }, 'Market snapshot validation failed');
        } else {
            logger.error({ error, fetcher: this.name }, 'Market fetch failed');
        }
    }
}
