import { MongoServerError } from 'mongodb';
import {
    MarketReliabilityModel,
    type MarketReliabilityDoc
} from '../../database/models/market-reliability-model.js';
import { MarketReliabilityHistoryModel } from '../../database/models/market-reliability-history-model.js';

const AVAILABILITY_EMA_ALPHA = 0.3;

/**
 * Maintains rolling reliability metrics for external market data providers.
 * The service updates success and failure streaks, smooths availability readings, and records historical snapshots so operators can audit feed health.
 * By centralizing this logic we can surface accurate market reliability data without risking race conditions or missing history entries.
 */
export class MarketReliabilityService {
    /**
     * Records a successful market fetch outcome.
     * The method increments success counters, resets failure streaks, recomputes reliability, and writes a history entry so dashboards keep an accurate trail.
     * Retrying on duplicate key errors prevents concurrent fetchers from crashing the backend when they initialize the same provider simultaneously.
     */
    async recordSuccess(guid: string, availabilityPercent?: number, effectivePrice?: number) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const doc = (await MarketReliabilityModel.findOne({ guid })) ?? new MarketReliabilityModel({ guid });

            doc.successCount = (doc.successCount ?? 0) + 1;
            doc.successStreak = (doc.successStreak ?? 0) + 1;
            doc.failureStreak = 0;
            doc.lastSuccess = new Date();

            if (availabilityPercent !== undefined) {
                doc.emaAvailability = this.calculateEma(doc, availabilityPercent);
            }

            doc.reliability = this.calculateReliability(doc);

            try {
                await doc.save();
                await this.persistHistory({
                    guid,
                    status: 'success',
                    reliability: doc.reliability,
                    availabilityPercent,
                    effectivePrice
                });
                return doc.reliability;
            } catch (error) {
                if (!this.isDuplicateKeyError(error) || attempt === 2) {
                    throw error;
                }
            }
        }

        throw new Error(`Failed to persist market reliability success record for ${guid} after retries.`);
    }

    /**
     * Records a failed market fetch outcome.
     * The method increments failure counters, resets the success streak, captures the failure reason, and persists a history entry so support teams can diagnose outages.
     * Retrying on duplicate key errors similarly shields the backend from race conditions when multiple workers hit the same provider at startup.
     */
    async recordFailure(guid: string, reason?: unknown) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const doc = (await MarketReliabilityModel.findOne({ guid })) ?? new MarketReliabilityModel({ guid });

            doc.failureCount = (doc.failureCount ?? 0) + 1;
            doc.failureStreak = (doc.failureStreak ?? 0) + 1;
            doc.successStreak = 0;
            doc.lastFailure = new Date();

            doc.reliability = this.calculateReliability(doc);

            try {
                await doc.save();
                await this.persistHistory({
                    guid,
                    status: 'failure',
                    reliability: doc.reliability,
                    failureReason: this.formatFailureReason(reason)
                });
                return doc.reliability;
            } catch (error) {
                if (!this.isDuplicateKeyError(error) || attempt === 2) {
                    throw error;
                }
            }
        }

        throw new Error(`Failed to persist market reliability failure record for ${guid} after retries.`);
    }

    /**
     * Retrieves the latest reliability score for a provider.
     * The method fetches the current document so UI consumers can surface an up-to-date reliability percentage.
     * Returning undefined when the provider has no history keeps callers resilient to newly onboarded data sources.
     */
    async getReliability(guid: string) {
        const doc = await MarketReliabilityModel.findOne({ guid });
        return doc?.reliability;
    }

    /**
     * Computes the reliability ratio from tracked successes and failures.
     * The method divides the success count by the total attempts to produce a bounded metric between zero and one for downstream consumers.
     * Guarding against division by zero ensures the backend behaves predictably before any observations have been recorded.
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
     * The method blends the newest availability reading with historical data so we react quickly to outages without overreacting to spikes.
     * Rounding the result keeps the stored values compact and wards off floating point drift across repeated updates.
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
     * The method writes a document capturing the latest outcome, availability, and pricing context so trend analytics have complete data.
     * Keeping this log immutable enables long-term investigations whenever market feeds degrade in unexpected ways.
     */
    private async persistHistory(entry: {
        guid: string;
        status: 'success' | 'failure';
        reliability?: number;
        availabilityPercent?: number;
        effectivePrice?: number;
        failureReason?: string;
    }) {
        await MarketReliabilityHistoryModel.create({
            guid: entry.guid,
            status: entry.status,
            reliability: entry.reliability,
            availabilityPercent: entry.availabilityPercent,
            effectivePrice: entry.effectivePrice,
            failureReason: entry.failureReason
        });
    }

    /**
     * Normalizes an arbitrary failure reason into a bounded string representation.
     * The method extracts meaningful text from errors, plain strings, or objects so stored history remains concise and understandable.
     * Truncating large payloads protects the database from bloating while still surfacing the root cause to operators.
     */
    private formatFailureReason(reason: unknown) {
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
     * The method inspects the thrown error so the caller can safely retry only when another worker already created the target document.
     * Filtering in this way prevents silent data loss while still surfacing genuine persistence faults immediately.
     */
    private isDuplicateKeyError(error: unknown): boolean {
        return error instanceof MongoServerError && error.code === 11000;
    }
}
