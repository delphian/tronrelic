/**
 * @fileoverview Bidirectional timestamp, date, and TRON block number converter.
 *
 * Converts between Unix timestamps, ISO date strings, and approximate TRON
 * block numbers using a cached reference block from TronGrid. Block estimates
 * assume the standard 3-second interval and drift over large ranges.
 */

import type { ICacheService } from '@/types';
import type { TronGridClient } from '../../blockchain/tron-grid.client.js';
import { ValidationError } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';

/** TRON target block interval in milliseconds. */
const BLOCK_INTERVAL_MS = 3000;

/** Cache TTL for the reference block in seconds. */
const REF_BLOCK_CACHE_TTL = 60;

/** Cached reference block structure. */
interface ReferenceBlock {
    number: number;
    timestamp: number;
}

/** Complete result from a timestamp conversion. */
export interface ITimestampConversionResult {
    /** Unix timestamp in seconds. */
    timestamp: number;
    /** Unix timestamp in milliseconds. */
    timestampMs: number;
    /** ISO 8601 UTC date string. */
    dateString: string;
    /** Estimated TRON block number. */
    blockNumber: number;
    /** True when block number is estimated rather than exact. */
    blockNumberIsEstimate: boolean;
    /** Human-readable relative time (e.g., "2 hours ago"). */
    relativeTime: string;
    /** Reference block used for the conversion. */
    referenceBlock: ReferenceBlock;
}

/** Input for the convert method — exactly one field must be provided. */
export interface ITimestampConvertInput {
    /** Unix timestamp in seconds. */
    timestamp?: number;
    /** TRON block number. */
    blockNumber?: number;
    /** ISO 8601 or parseable date string. */
    dateString?: string;
}

/**
 * Service for bidirectional conversion between timestamps, dates, and TRON blocks.
 *
 * Uses a cached reference block (current head) from TronGrid to estimate
 * conversions based on the 3-second block interval. Block estimates become
 * less accurate further from the reference point.
 */
export class TimestampService {
    /** Module-scoped logger. */
    private readonly logger = logger.child({ service: 'TimestampService' });

    /**
     * @param tronGridClient - TronGridClient singleton for fetching current block
     * @param cache - Cache service for reference block TTL caching
     */
    constructor(
        private readonly tronGridClient: TronGridClient,
        private readonly cache: ICacheService
    ) {}

    /**
     * Convert between timestamp, date string, and TRON block number.
     *
     * Accepts exactly one input field and returns all three representations
     * along with a relative time string and the reference block used.
     *
     * @param input - Object with exactly one of timestamp, blockNumber, or dateString
     * @returns All representations of the converted value
     * @throws ValidationError if input is invalid or unparseable
     */
    async convert(input: ITimestampConvertInput): Promise<ITimestampConversionResult> {
        const ref = await this.getReferenceBlock();
        let timestampMs: number;

        if (input.timestamp !== undefined) {
            timestampMs = input.timestamp * 1000;
        } else if (input.blockNumber !== undefined) {
            if (input.blockNumber < 1) {
                throw new ValidationError('Block number must be at least 1', { blockNumber: input.blockNumber });
            }
            const blockDelta = input.blockNumber - ref.number;
            timestampMs = ref.timestamp + (blockDelta * BLOCK_INTERVAL_MS);
        } else if (input.dateString !== undefined) {
            const parsed = Date.parse(input.dateString);
            if (isNaN(parsed)) {
                throw new ValidationError('Invalid date string', { dateString: input.dateString });
            }
            timestampMs = parsed;
        } else {
            throw new ValidationError('Provide exactly one of: timestamp, blockNumber, or dateString');
        }

        const timestampSec = Math.floor(timestampMs / 1000);
        const dateString = new Date(timestampMs).toISOString();

        const blockNumberIsEstimate = input.blockNumber === undefined;
        const blockNumber = blockNumberIsEstimate
            ? Math.max(1, ref.number + Math.round((timestampMs - ref.timestamp) / BLOCK_INTERVAL_MS))
            : input.blockNumber!;

        const result: ITimestampConversionResult = {
            timestamp: timestampSec,
            timestampMs,
            dateString,
            blockNumber,
            blockNumberIsEstimate,
            relativeTime: this.getRelativeTime(timestampMs),
            referenceBlock: ref
        };

        return result;
    }

    /**
     * Get the current reference block, using cache when available.
     *
     * Fetches the latest block from TronGrid and caches it for 60 seconds
     * to avoid redundant API calls for sequential conversions.
     *
     * @returns Reference block with number and timestamp
     * @throws Error if TronGrid is unreachable
     */
    private async getReferenceBlock(): Promise<ReferenceBlock> {
        const cacheKey = 'tools:timestamp:ref-block';

        const cached = await this.cache.get<ReferenceBlock>(cacheKey);
        if (cached) {
            return cached;
        }

        const block = await this.tronGridClient.getNowBlock();
        const ref: ReferenceBlock = {
            number: block.block_header.raw_data.number,
            timestamp: block.block_header.raw_data.timestamp
        };

        await this.cache.set(cacheKey, ref, REF_BLOCK_CACHE_TTL, ['tools:timestamp']);

        this.logger.debug({ ref }, 'Cached reference block for timestamp conversions');

        return ref;
    }

    /**
     * Compute a human-readable relative time string.
     *
     * @param timestampMs - Target timestamp in milliseconds
     * @returns Relative description (e.g., "2 hours ago", "in 3 days")
     */
    private getRelativeTime(timestampMs: number): string {
        const diffMs = Date.now() - timestampMs;
        const absDiffMs = Math.abs(diffMs);
        const isPast = diffMs > 0;

        const seconds = Math.floor(absDiffMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        const years = Math.floor(days / 365);

        let label: string;
        if (seconds < 60) {
            label = `${seconds} second${seconds !== 1 ? 's' : ''}`;
        } else if (minutes < 60) {
            label = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else if (hours < 24) {
            label = `${hours} hour${hours !== 1 ? 's' : ''}`;
        } else if (days < 365) {
            label = `${days} day${days !== 1 ? 's' : ''}`;
        } else {
            label = `${years} year${years !== 1 ? 's' : ''}`;
        }

        if (seconds < 5) {
            return 'just now';
        }

        return isPast ? `${label} ago` : `in ${label}`;
    }
}
