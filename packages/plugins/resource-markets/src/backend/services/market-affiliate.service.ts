import { createHash } from 'crypto';
import type { IPluginContext } from '@tronrelic/types';

/**
 * Affiliate tracking document stored in plugin database.
 */
export interface MarketAffiliateDoc {
    guid: string;
    link: string;
    conversion?: string;
    trackingCode: string;
    impressions: number;
    clicks: number;
    lastClickAt?: Date;
}

/**
 * Affiliate tracking data returned by service methods.
 */
export interface MarketAffiliateTracking {
    link: string;
    conversion?: string;
    trackingCode: string;
    impressions?: number;
    clicks?: number;
    lastClickAt?: string;
}

/**
 * Market affiliate tracking service.
 *
 * Manages affiliate link tracking for market platforms, recording impressions
 * and clicks for commission attribution. Generates unique tracking codes for
 * each market to enable click attribution without exposing market identifiers.
 *
 * **Features:**
 * - Automatic tracking code generation (SHA-256 hash of market GUID)
 * - Impression counting (affiliate link displayed to user)
 * - Click tracking with timestamp (user clicked affiliate link)
 * - Conversion tracking support (for future integration)
 *
 * **Collections used:**
 * - `affiliate_tracking` - Affiliate metrics per market
 *
 * @param context - Plugin context with database and logger access
 */
export class MarketAffiliateService {
    constructor(private readonly context: IPluginContext) {}

    /**
     * Generates a unique tracking code for a market.
     *
     * Uses SHA-256 hash of market GUID to create a short, deterministic code
     * that doesn't expose the underlying market identifier.
     *
     * @param guid - Market identifier
     * @returns 12-character tracking code
     */
    private generateTrackingCode(guid: string): string {
        return createHash('sha256')
            .update(`market-affiliate:${guid}`)
            .digest('hex')
            .slice(0, 12);
    }

    /**
     * Ensures affiliate tracking is set up for a market.
     *
     * Creates or updates affiliate tracking configuration. If link is provided,
     * initializes tracking record with generated tracking code. If link is empty,
     * returns undefined (no tracking).
     *
     * @param guid - Market identifier
     * @param link - Affiliate link URL
     * @param conversion - Optional conversion tracking URL
     * @returns Affiliate tracking data or undefined if no link
     */
    async ensureTracking(
        guid: string,
        link?: string | null,
        conversion?: string | null
    ): Promise<MarketAffiliateTracking | undefined> {
        if (!guid || !link) {
            return undefined;
        }

        const trackingCode = this.generateTrackingCode(guid);

        // Check if tracking record already exists
        let doc = await this.context.database.findOne<MarketAffiliateDoc>('affiliate_tracking', { guid });

        if (!doc) {
            // Create new tracking record
            const newDoc: MarketAffiliateDoc = {
                guid,
                link,
                conversion: conversion ?? undefined,
                trackingCode,
                impressions: 0,
                clicks: 0
            };

            const collection = this.context.database.getCollection('affiliate_tracking');
            await collection.insertOne(newDoc);

            return this.toTracking(newDoc);
        }

        // Update existing record if fields changed
        let needsUpdate = false;
        const updates: Partial<MarketAffiliateDoc> = {};

        if (doc.link !== link) {
            updates.link = link;
            needsUpdate = true;
        }

        const normalizedConversion = conversion ?? undefined;
        if (doc.conversion !== normalizedConversion) {
            updates.conversion = normalizedConversion;
            needsUpdate = true;
        }

        if (doc.trackingCode !== trackingCode) {
            updates.trackingCode = trackingCode;
            needsUpdate = true;
        }

        if (needsUpdate) {
            const collection = this.context.database.getCollection('affiliate_tracking');
            await collection.updateOne({ guid }, { $set: updates });

            // Refetch to get updated document
            doc = await this.context.database.findOne<MarketAffiliateDoc>('affiliate_tracking', { guid });
        }

        return doc ? this.toTracking(doc) : undefined;
    }

    /**
     * Records an affiliate link impression.
     *
     * Increments the impression counter when an affiliate link is displayed
     * to a user. Used for tracking affiliate link visibility and calculating
     * click-through rates.
     *
     * @param guid - Market identifier
     * @param trackingCode - Tracking code for validation
     * @returns Updated affiliate tracking data or null if not found
     */
    async recordImpression(guid: string, trackingCode: string): Promise<MarketAffiliateTracking | null> {
        const collection = this.context.database.getCollection('affiliate_tracking');
        const result = await collection.findOneAndUpdate(
            { guid, trackingCode },
            { $inc: { impressions: 1 } },
            { returnDocument: 'after' }
        );

        if (!result) {
            this.context.logger.warn({ guid, trackingCode }, 'Affiliate tracking record not found for impression');
            return null;
        }

        return this.toTracking(result as unknown as MarketAffiliateDoc);
    }

    /**
     * Records an affiliate link click.
     *
     * Increments the click counter and updates the last click timestamp when
     * a user clicks an affiliate link. Used for tracking conversion attribution
     * and calculating click-through rates.
     *
     * @param guid - Market identifier
     * @param trackingCode - Tracking code for validation
     * @returns Updated affiliate tracking data or null if not found
     */
    async recordClick(guid: string, trackingCode: string): Promise<MarketAffiliateTracking | null> {
        const collection = this.context.database.getCollection('affiliate_tracking');
        const result = await collection.findOneAndUpdate(
            { guid, trackingCode },
            {
                $inc: { clicks: 1 },
                $set: { lastClickAt: new Date() }
            },
            { returnDocument: 'after' }
        );

        if (!result) {
            this.context.logger.warn({ guid, trackingCode }, 'Affiliate tracking record not found for click');
            return null;
        }

        return this.toTracking(result as unknown as MarketAffiliateDoc);
    }

    /**
     * Retrieves affiliate tracking metrics for a market.
     *
     * @param guid - Market identifier
     * @returns Affiliate tracking data or null if not found
     */
    async getTracking(guid: string): Promise<MarketAffiliateTracking | null> {
        const doc = await this.context.database.findOne<MarketAffiliateDoc>('affiliate_tracking', { guid });
        return doc ? this.toTracking(doc) : null;
    }

    /**
     * Converts database document to tracking data response.
     *
     * @param doc - Affiliate tracking database document
     * @returns Affiliate tracking response object
     */
    private toTracking(doc: MarketAffiliateDoc): MarketAffiliateTracking {
        return {
            link: doc.link,
            conversion: doc.conversion,
            trackingCode: doc.trackingCode,
            impressions: doc.impressions,
            clicks: doc.clicks,
            lastClickAt: doc.lastClickAt ? doc.lastClickAt.toISOString() : undefined
        };
    }
}
