import type { IPluginContext } from '@tronrelic/types';

/**
 * Exponential moving average smoothing factor for availability metrics.
 * Higher alpha (0.3) gives more weight to recent observations.
 */
const AVAILABILITY_EMA_ALPHA = 0.3;

/**
 * Market reliability document stored in plugin database.
 * Tracks success/failure statistics and computed reliability scores.
 */
export interface MarketReliabilityDoc {
    guid: string;
    successCount: number;
    failureCount: number;
    successStreak: number;
    failureStreak: number;
    lastSuccess?: Date;
    lastFailure?: Date;
    reliability: number;
    emaAvailability?: number;
}

/**
 * Historical reliability snapshot stored for trend analysis.
 */
export interface MarketReliabilityHistoryEntry {
    guid: string;
    status: 'success' | 'failure';
    reliability?: number;
    availabilityPercent?: number;
    effectivePrice?: number;
    failureReason?: string;
    recordedAt: Date;
}

/**
 * Maintains rolling reliability metrics for external market data providers.
 *
 * The service tracks success and failure counts, computes reliability scores,
 * smooths availability metrics using exponential moving averages, and records
 * historical snapshots for audit trails.
 *
 * **Features:**
 * - Success/failure counters with streak tracking
 * - Reliability score computation (0-1 scale based on success rate)
 * - EMA-smoothed availability percentages
 * - Historical snapshots for trend analysis
 * - Retry logic for concurrent write protection
 *
 * **Collections used:**
 * - `reliability` - Current reliability state per market
 * - `reliability_history` - Historical snapshots
 *
 * @param context - Plugin context with database and logger access
 */
export class MarketReliabilityService {
    constructor(private readonly context: IPluginContext) {}

    /**
     * Records a successful market fetch outcome.
     *
     * Increments success counters, resets failure streaks, recomputes reliability
     * score, and persists a historical snapshot. Uses retry logic to handle
     * concurrent write conflicts when multiple workers initialize the same provider.
     *
     * @param guid - Market identifier
     * @param availabilityPercent - Optional availability percentage for EMA calculation
     * @param effectivePrice - Optional effective price for historical tracking
     * @returns Computed reliability score (0-1)
     */
    async recordSuccess(guid: string, availabilityPercent?: number, effectivePrice?: number): Promise<number> {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                // Fetch current reliability doc or create new one
                let doc = await this.context.database.findOne<MarketReliabilityDoc>('reliability', { guid });

                if (!doc) {
                    doc = {
                        guid,
                        successCount: 0,
                        failureCount: 0,
                        successStreak: 0,
                        failureStreak: 0,
                        reliability: 0
                    };
                }

                // Update success metrics
                doc.successCount = (doc.successCount ?? 0) + 1;
                doc.successStreak = (doc.successStreak ?? 0) + 1;
                doc.failureStreak = 0;
                doc.lastSuccess = new Date();

                // Update EMA availability if provided
                if (availabilityPercent !== undefined) {
                    doc.emaAvailability = this.calculateEma(doc, availabilityPercent);
                }

                // Recompute reliability score
                doc.reliability = this.calculateReliability(doc);

                // Persist updated document
                const collection = this.context.database.getCollection('reliability');
                await collection.updateOne(
                    { guid },
                    { $set: doc },
                    { upsert: true }
                );

                // Record historical snapshot
                await this.persistHistory({
                    guid,
                    status: 'success',
                    reliability: doc.reliability,
                    availabilityPercent,
                    effectivePrice
                });

                return doc.reliability;
            } catch (error) {
                // Retry on duplicate key errors (concurrent initialization)
                if (attempt === 2 || !this.isDuplicateKeyError(error)) {
                    this.context.logger.error({ error, guid }, 'Failed to record market reliability success');
                    throw error;
                }
            }
        }

        throw new Error(`Failed to persist market reliability success record for ${guid} after retries.`);
    }

    /**
     * Records a failed market fetch outcome.
     *
     * Increments failure counters, resets success streaks, captures the failure
     * reason, and persists a historical snapshot. Uses retry logic to handle
     * concurrent write conflicts.
     *
     * @param guid - Market identifier
     * @param reason - Optional failure reason (error, string, or object)
     * @returns Computed reliability score (0-1)
     */
    async recordFailure(guid: string, reason?: unknown): Promise<number> {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
                // Fetch current reliability doc or create new one
                let doc = await this.context.database.findOne<MarketReliabilityDoc>('reliability', { guid });

                if (!doc) {
                    doc = {
                        guid,
                        successCount: 0,
                        failureCount: 0,
                        successStreak: 0,
                        failureStreak: 0,
                        reliability: 0
                    };
                }

                // Update failure metrics
                doc.failureCount = (doc.failureCount ?? 0) + 1;
                doc.failureStreak = (doc.failureStreak ?? 0) + 1;
                doc.successStreak = 0;
                doc.lastFailure = new Date();

                // Recompute reliability score
                doc.reliability = this.calculateReliability(doc);

                // Persist updated document
                const collection = this.context.database.getCollection('reliability');
                await collection.updateOne(
                    { guid },
                    { $set: doc },
                    { upsert: true }
                );

                // Record historical snapshot with failure reason
                await this.persistHistory({
                    guid,
                    status: 'failure',
                    reliability: doc.reliability,
                    failureReason: this.formatFailureReason(reason)
                });

                return doc.reliability;
            } catch (error) {
                // Retry on duplicate key errors (concurrent initialization)
                if (attempt === 2 || !this.isDuplicateKeyError(error)) {
                    this.context.logger.error({ error, guid }, 'Failed to record market reliability failure');
                    throw error;
                }
            }
        }

        throw new Error(`Failed to persist market reliability failure record for ${guid} after retries.`);
    }

    /**
     * Retrieves the latest reliability score for a provider.
     *
     * @param guid - Market identifier
     * @returns Reliability score (0-1) or undefined if no history exists
     */
    async getReliability(guid: string): Promise<number | undefined> {
        const doc = await this.context.database.findOne<MarketReliabilityDoc>('reliability', { guid });
        return doc?.reliability;
    }

    /**
     * Retrieves reliability metrics for a provider.
     *
     * @param guid - Market identifier
     * @returns Full reliability document or null if not found
     */
    async getReliabilityMetrics(guid: string): Promise<MarketReliabilityDoc | null> {
        return this.context.database.findOne<MarketReliabilityDoc>('reliability', { guid });
    }

    /**
     * Computes the reliability ratio from tracked successes and failures.
     *
     * Divides success count by total attempts to produce a metric between 0 and 1.
     * Returns 0 if no observations have been recorded yet.
     *
     * @param doc - Reliability document with success/failure counts
     * @returns Reliability score between 0 and 1
     */
    private calculateReliability(doc: MarketReliabilityDoc): number {
        const successCount = doc.successCount ?? 0;
        const failureCount = doc.failureCount ?? 0;
        const total = successCount + failureCount;

        if (!total) {
            return 0;
        }

        return Number((successCount / total).toFixed(4));
    }

    /**
     * Updates the exponential moving average availability metric.
     *
     * Blends the newest availability reading with historical data using EMA
     * to react quickly to changes without overreacting to temporary spikes.
     *
     * @param doc - Reliability document with previous EMA value
     * @param availability - New availability percentage
     * @returns Updated EMA availability
     */
    private calculateEma(doc: MarketReliabilityDoc, availability: number): number {
        if (!doc.emaAvailability) {
            return Number(availability.toFixed(2));
        }

        const ema = AVAILABILITY_EMA_ALPHA * availability + (1 - AVAILABILITY_EMA_ALPHA) * doc.emaAvailability;
        return Number(ema.toFixed(2));
    }

    /**
     * Persists a market reliability history entry.
     *
     * Writes an immutable snapshot capturing the latest outcome, availability,
     * and pricing context for long-term trend analysis.
     *
     * @param entry - Historical reliability entry to persist
     */
    private async persistHistory(entry: {
        guid: string;
        status: 'success' | 'failure';
        reliability?: number;
        availabilityPercent?: number;
        effectivePrice?: number;
        failureReason?: string;
    }): Promise<void> {
        const historyEntry: MarketReliabilityHistoryEntry = {
            guid: entry.guid,
            status: entry.status,
            reliability: entry.reliability,
            availabilityPercent: entry.availabilityPercent,
            effectivePrice: entry.effectivePrice,
            failureReason: entry.failureReason,
            recordedAt: new Date()
        };

        const collection = this.context.database.getCollection('reliability_history');
        await collection.insertOne(historyEntry);
    }

    /**
     * Normalizes an arbitrary failure reason into a bounded string representation.
     *
     * Extracts meaningful text from errors, plain strings, or objects. Truncates
     * large payloads to protect database from bloating while preserving root cause.
     *
     * @param reason - Failure reason (error, string, or object)
     * @returns Formatted failure reason string (max 512 chars)
     */
    private formatFailureReason(reason: unknown): string | undefined {
        if (!reason) {
            return undefined;
        }

        if (typeof reason === 'string') {
            return reason.slice(0, 512);
        }

        if (reason instanceof Error) {
            return reason.message.slice(0, 512);
        }

        try {
            return JSON.stringify(reason).slice(0, 512);
        } catch (error) {
            return 'unknown_failure';
        }
    }

    /**
     * Detects duplicate key write races from MongoDB.
     *
     * Inspects thrown errors to identify when another worker already created
     * the target document, allowing safe retry without silent data loss.
     *
     * @param error - Error thrown during database operation
     * @returns True if error is a duplicate key conflict
     */
    private isDuplicateKeyError(error: unknown): boolean {
        return error instanceof Error && 'code' in error && error.code === 11000;
    }
}
