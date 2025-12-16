/**
 * Address label service implementation.
 *
 * Singleton service providing CRUD operations, queries, and bulk operations
 * for blockchain address labels. Labels enable human-readable identification
 * of addresses throughout the platform.
 *
 * ## Design Decisions
 *
 * - **Singleton pattern**: Shared state and caching across all consumers
 * - **Redis caching**: Individual address lookups cached for performance
 * - **Confidence-based resolution**: When multiple sources label an address,
 *   the highest-confidence label wins
 * - **Source isolation**: Each source can only modify its own labels
 */

import type { Collection, Filter } from 'mongodb';
import type {
    IDatabaseService,
    ICacheService,
    ISystemLogService,
    IAddressLabel,
    IAddressLabelService,
    ICreateAddressLabelInput,
    IUpdateAddressLabelInput,
    IAddressLabelFilter,
    IAddressLabelImportResult,
    IAddressLabelListResult,
    IResolvedAddressLabel
} from '@tronrelic/types';
import type { IAddressLabelDocument } from '../database/index.js';

/**
 * Statistics for admin dashboard.
 */
export interface IAddressLabelStats {
    total: number;
    byCategory: Record<string, number>;
    bySourceType: Record<string, number>;
    verified: number;
    unverified: number;
}

/**
 * Address label service singleton.
 *
 * Provides CRUD operations and queries for address labels with Redis caching
 * and confidence-based resolution for multi-source labels.
 */
export class AddressLabelService implements IAddressLabelService {
    private static instance: AddressLabelService;

    private readonly collection: Collection<IAddressLabelDocument>;
    private readonly CACHE_KEY_PREFIX = 'address-label:';
    private readonly CACHE_TTL = 3600; // 1 hour
    private readonly MAX_LIMIT = 200;
    private readonly DEFAULT_LIMIT = 50;

    /**
     * Create the address label service.
     *
     * Private constructor enforces singleton pattern.
     *
     * @param database - Database service for MongoDB operations
     * @param cacheService - Redis cache for label lookups
     * @param logger - System log service
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly logger: ISystemLogService
    ) {
        this.collection = database.getCollection<IAddressLabelDocument>('address_labels');
    }

    /**
     * Initialize the singleton instance with dependencies.
     *
     * Must be called before getInstance(). Called during module init() phase.
     *
     * @param database - Database service
     * @param cacheService - Cache service
     * @param logger - System log service
     */
    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        logger: ISystemLogService
    ): void {
        if (!AddressLabelService.instance) {
            AddressLabelService.instance = new AddressLabelService(database, cacheService, logger);
        }
    }

    /**
     * Get the singleton instance.
     *
     * @returns AddressLabelService instance
     * @throws Error if setDependencies() has not been called
     */
    public static getInstance(): AddressLabelService {
        if (!AddressLabelService.instance) {
            throw new Error('AddressLabelService.setDependencies() must be called before getInstance()');
        }
        return AddressLabelService.instance;
    }

    /**
     * Create database indexes for optimal query performance.
     *
     * Called during module init() phase.
     */
    async createIndexes(): Promise<void> {
        // Compound unique index: one label per address+source combination
        await this.collection.createIndex(
            { address: 1, source: 1 },
            { unique: true }
        );

        // Index for address lookups (most common query)
        await this.collection.createIndex({ address: 1 });

        // Index for category filtering
        await this.collection.createIndex({ category: 1 });

        // Index for source type filtering
        await this.collection.createIndex({ sourceType: 1 });

        // Index for verified status
        await this.collection.createIndex({ verified: 1 });

        // Index for confidence-based sorting
        await this.collection.createIndex({ confidence: -1 });

        // Text index for search
        await this.collection.createIndex(
            { label: 'text', notes: 'text', address: 'text' },
            { name: 'address_label_text_search' }
        );

        this.logger.info('Address label indexes created');
    }

    // =========================================================================
    // CRUD Operations
    // =========================================================================

    /**
     * Create or update an address label.
     *
     * Uses upsert semantics based on address+source combination.
     */
    async create(input: ICreateAddressLabelInput): Promise<IAddressLabel> {
        const now = new Date();

        // Note: We intentionally skip TRON address format validation (base58check, 'T' prefix,
        // length, checksum). Full validation is complex and the system tolerates invalid entries
        // gracefully - labels for non-existent addresses simply never match blockchain data.
        // This also allows flexibility for edge cases like contract addresses or future formats.
        // Build update fields without createdAt (handled separately via $setOnInsert)
        const updateFields = {
            address: input.address.trim(),
            label: input.label.trim(),
            category: input.category,
            tags: input.tags || [],
            source: input.source,
            sourceType: input.sourceType,
            confidence: input.confidence ?? 50,
            verified: input.verified ?? false,
            tronMetadata: input.tronMetadata,
            notes: input.notes?.trim(),
            customMetadata: input.customMetadata,
            updatedAt: now
        };

        const result = await this.collection.findOneAndUpdate(
            { address: updateFields.address, source: updateFields.source },
            {
                $set: updateFields,
                $setOnInsert: { createdAt: now }
            },
            { upsert: true, returnDocument: 'after' }
        );

        if (!result) {
            throw new Error(`Failed to create label for address ${input.address}`);
        }

        // Invalidate cache for this address
        await this.invalidateCache(updateFields.address);

        this.logger.debug({ address: updateFields.address, source: updateFields.source }, 'Address label created/updated');

        return this.toPublicLabel(result);
    }

    /**
     * Find the highest-confidence label for an address.
     */
    async findByAddress(address: string): Promise<IAddressLabel | null> {
        const cacheKey = `${this.CACHE_KEY_PREFIX}${address}`;

        // Check cache first
        const cached = await this.cacheService.get<IAddressLabel>(cacheKey);
        if (cached) {
            return cached;
        }

        // Query for highest confidence label
        const doc = await this.collection.findOne(
            { address },
            { sort: { confidence: -1, verified: -1 } }
        );

        if (!doc) {
            return null;
        }

        const label = this.toPublicLabel(doc);

        // Cache the result
        await this.cacheService.set(cacheKey, label, this.CACHE_TTL);

        return label;
    }

    /**
     * Find labels for multiple addresses efficiently.
     *
     * Used for batch enrichment of transaction lists.
     */
    async findByAddresses(addresses: string[]): Promise<Map<string, IAddressLabel>> {
        const result = new Map<string, IAddressLabel>();
        const uncached: string[] = [];

        // Check cache for each address
        for (const address of addresses) {
            const cacheKey = `${this.CACHE_KEY_PREFIX}${address}`;
            const cached = await this.cacheService.get<IAddressLabel>(cacheKey);
            if (cached) {
                result.set(address, cached);
            } else {
                uncached.push(address);
            }
        }

        // Query MongoDB for uncached addresses
        if (uncached.length > 0) {
            // Get all labels for uncached addresses
            const docs = await this.collection
                .find({ address: { $in: uncached } })
                .sort({ confidence: -1, verified: -1 })
                .toArray();

            // Group by address and take highest confidence
            const byAddress = new Map<string, IAddressLabelDocument>();
            for (const doc of docs) {
                if (!byAddress.has(doc.address)) {
                    byAddress.set(doc.address, doc);
                }
            }

            // Convert and cache
            for (const [address, doc] of byAddress) {
                const label = this.toPublicLabel(doc);
                result.set(address, label);

                // Cache individual results
                const cacheKey = `${this.CACHE_KEY_PREFIX}${address}`;
                await this.cacheService.set(cacheKey, label, this.CACHE_TTL);
            }
        }

        return result;
    }

    /**
     * Update an existing label.
     *
     * Only the source that created a label can update it.
     */
    async update(address: string, source: string, updates: IUpdateAddressLabelInput): Promise<IAddressLabel> {
        const updateDoc: Record<string, unknown> = {
            updatedAt: new Date()
        };

        if (updates.label !== undefined) updateDoc.label = updates.label.trim();
        if (updates.category !== undefined) updateDoc.category = updates.category;
        if (updates.tags !== undefined) updateDoc.tags = updates.tags;
        if (updates.confidence !== undefined) updateDoc.confidence = updates.confidence;
        if (updates.verified !== undefined) updateDoc.verified = updates.verified;
        if (updates.notes !== undefined) updateDoc.notes = updates.notes?.trim();

        // Merge metadata objects with existing values (as documented in IUpdateAddressLabelInput)
        if (updates.tronMetadata !== undefined || updates.customMetadata !== undefined) {
            const existing = await this.collection.findOne({ address, source });
            if (existing) {
                if (updates.tronMetadata !== undefined) {
                    updateDoc['tronMetadata'] = { ...existing.tronMetadata, ...updates.tronMetadata };
                }
                if (updates.customMetadata !== undefined) {
                    updateDoc['customMetadata'] = { ...existing.customMetadata, ...updates.customMetadata };
                }
            } else {
                // No existing doc, just use provided values
                if (updates.tronMetadata !== undefined) updateDoc['tronMetadata'] = updates.tronMetadata;
                if (updates.customMetadata !== undefined) updateDoc['customMetadata'] = updates.customMetadata;
            }
        }

        const result = await this.collection.findOneAndUpdate(
            { address, source },
            { $set: updateDoc },
            { returnDocument: 'after' }
        );

        if (!result) {
            throw new Error(`Label not found for address ${address} from source ${source}`);
        }

        // Invalidate cache
        await this.invalidateCache(address);

        this.logger.debug({ address, source }, 'Address label updated');

        return this.toPublicLabel(result);
    }

    /**
     * Delete a label.
     *
     * Only the source that created a label can delete it.
     */
    async delete(address: string, source: string): Promise<void> {
        const result = await this.collection.deleteOne({ address, source });

        if (result.deletedCount === 0) {
            throw new Error(`Label not found for address ${address} from source ${source}`);
        }

        // Invalidate cache
        await this.invalidateCache(address);

        this.logger.debug({ address, source }, 'Address label deleted');
    }

    // =========================================================================
    // Queries
    // =========================================================================

    /**
     * List labels with optional filtering and pagination.
     */
    async list(
        filter?: IAddressLabelFilter,
        page: number = 1,
        limit: number = this.DEFAULT_LIMIT
    ): Promise<IAddressLabelListResult> {
        const query = this.buildFilterQuery(filter);
        const safeLimit = Math.min(limit, this.MAX_LIMIT);
        const skip = (page - 1) * safeLimit;

        const [docs, total] = await Promise.all([
            this.collection
                .find(query)
                .sort({ confidence: -1, label: 1 })
                .skip(skip)
                .limit(safeLimit)
                .toArray(),
            this.collection.countDocuments(query)
        ]);

        return {
            labels: docs.map(doc => this.toPublicLabel(doc)),
            total,
            page,
            limit: safeLimit
        };
    }

    /**
     * Search labels by text query.
     */
    async search(query: string, limit: number = 20): Promise<IAddressLabel[]> {
        const safeLimit = Math.min(limit, this.MAX_LIMIT);

        // Use aggregation pipeline for text search with scoring
        const docs = await this.collection.aggregate<IAddressLabelDocument>([
            { $match: { $text: { $search: query } } },
            { $addFields: { score: { $meta: 'textScore' } } },
            { $sort: { score: -1 } },
            { $limit: safeLimit }
        ]).toArray();

        return docs.map(doc => this.toPublicLabel(doc));
    }

    /**
     * Resolve the best label for an address considering all sources.
     */
    async resolveLabel(address: string): Promise<IResolvedAddressLabel | null> {
        const docs = await this.collection
            .find({ address })
            .sort({ confidence: -1, verified: -1 })
            .toArray();

        if (docs.length === 0) {
            return null;
        }

        return {
            primary: this.toPublicLabel(docs[0]),
            alternates: docs.slice(1).map(doc => this.toPublicLabel(doc))
        };
    }

    // =========================================================================
    // Bulk Operations
    // =========================================================================

    /**
     * Import multiple labels in bulk.
     */
    async importLabels(labels: ICreateAddressLabelInput[]): Promise<IAddressLabelImportResult> {
        const result: IAddressLabelImportResult = {
            imported: 0,
            updated: 0,
            failed: 0,
            errors: []
        };

        for (const input of labels) {
            try {
                // Check if exists
                const existing = await this.collection.findOne({
                    address: input.address,
                    source: input.source
                });

                await this.create(input);

                if (existing) {
                    result.updated++;
                } else {
                    result.imported++;
                }
            } catch (error) {
                result.failed++;
                result.errors.push({
                    address: input.address,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        this.logger.info({
            imported: result.imported,
            updated: result.updated,
            failed: result.failed
        }, 'Bulk import completed');

        return result;
    }

    /**
     * Export labels matching filter criteria.
     */
    async exportLabels(filter?: IAddressLabelFilter): Promise<IAddressLabel[]> {
        const query = this.buildFilterQuery(filter);

        const docs = await this.collection
            .find(query)
            .sort({ address: 1 })
            .toArray();

        return docs.map(doc => this.toPublicLabel(doc));
    }

    // =========================================================================
    // Statistics
    // =========================================================================

    /**
     * Get label statistics for admin dashboard.
     */
    async getStats(): Promise<IAddressLabelStats> {
        const [
            total,
            byCategory,
            bySourceType,
            verified
        ] = await Promise.all([
            this.collection.countDocuments(),
            this.collection.aggregate<{ _id: string; count: number }>([
                { $group: { _id: '$category', count: { $sum: 1 } } }
            ]).toArray(),
            this.collection.aggregate<{ _id: string; count: number }>([
                { $group: { _id: '$sourceType', count: { $sum: 1 } } }
            ]).toArray(),
            this.collection.countDocuments({ verified: true })
        ]);

        return {
            total,
            byCategory: Object.fromEntries(byCategory.map(r => [r._id, r.count])),
            bySourceType: Object.fromEntries(bySourceType.map(r => [r._id, r.count])),
            verified,
            unverified: total - verified
        };
    }

    // =========================================================================
    // Private Helpers
    // =========================================================================

    /**
     * Convert MongoDB document to public IAddressLabel.
     */
    private toPublicLabel(doc: IAddressLabelDocument): IAddressLabel {
        return {
            address: doc.address,
            label: doc.label,
            category: doc.category,
            tags: doc.tags,
            source: doc.source,
            sourceType: doc.sourceType,
            confidence: doc.confidence,
            verified: doc.verified,
            tronMetadata: doc.tronMetadata,
            notes: doc.notes,
            customMetadata: doc.customMetadata,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt
        };
    }

    /**
     * Build MongoDB filter query from filter options.
     */
    private buildFilterQuery(filter?: IAddressLabelFilter): Filter<IAddressLabelDocument> {
        const query: Filter<IAddressLabelDocument> = {};

        if (!filter) {
            return query;
        }

        if (filter.category) {
            query.category = filter.category;
        }

        if (filter.sourceType) {
            query.sourceType = filter.sourceType;
        }

        if (filter.source) {
            query.source = filter.source;
        }

        if (filter.tag) {
            query.tags = filter.tag;
        }

        if (filter.verified !== undefined) {
            query.verified = filter.verified;
        }

        if (filter.minConfidence !== undefined) {
            query.confidence = { $gte: filter.minConfidence };
        }

        if (filter.search) {
            query.$text = { $search: filter.search };
        }

        return query;
    }

    /**
     * Invalidate cache for an address.
     */
    private async invalidateCache(address: string): Promise<void> {
        const cacheKey = `${this.CACHE_KEY_PREFIX}${address}`;
        await this.cacheService.del(cacheKey);
    }
}
