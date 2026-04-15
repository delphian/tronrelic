/**
 * Address label service interface.
 *
 * Defines the contract for address label CRUD operations and queries.
 * This interface enables plugins to access address labels through
 * dependency injection without importing concrete implementations.
 *
 * ## Usage
 *
 * Modules access via dependency injection during init().
 * Plugins access via IPluginContext.addressLabelService.
 *
 * @example
 * ```typescript
 * // In a plugin observer
 * const label = await context.addressLabelService.findByAddress(senderAddress);
 * if (label) {
 *     console.log(`Transaction from ${label.label}`);
 * }
 * ```
 */

import type { IAddressLabel, IResolvedAddressLabel, AddressCategory, AddressLabelSourceType } from './IAddressLabel.js';

/**
 * Input for creating a new address label.
 */
export interface ICreateAddressLabelInput {
    /** TRON address (base58 format) */
    address: string;

    /** Human-readable label */
    label: string;

    /** Primary category */
    category: AddressCategory;

    /** Additional tags (optional) */
    tags?: string[];

    /** Source identifier */
    source: string;

    /** Source type */
    sourceType: AddressLabelSourceType;

    /** Confidence score 0-100 (default: 50) */
    confidence?: number;

    /** Verified flag (default: false) */
    verified?: boolean;

    /** TRON-specific metadata (optional) */
    tronMetadata?: IAddressLabel['tronMetadata'];

    /** Notes (optional) */
    notes?: string;

    /** Custom metadata (optional) */
    customMetadata?: Record<string, unknown>;
}

/**
 * Input for updating an existing address label.
 *
 * All fields optional - only provided fields will be updated.
 */
export interface IUpdateAddressLabelInput {
    /** Updated label text */
    label?: string;

    /** Updated category */
    category?: AddressCategory;

    /** Updated tags (replaces existing) */
    tags?: string[];

    /** Updated confidence score */
    confidence?: number;

    /** Updated verified status */
    verified?: boolean;

    /** Updated TRON metadata (merges with existing) */
    tronMetadata?: IAddressLabel['tronMetadata'];

    /** Updated notes */
    notes?: string;

    /** Updated custom metadata (merges with existing) */
    customMetadata?: Record<string, unknown>;
}

/**
 * Filter options for querying address labels.
 */
export interface IAddressLabelFilter {
    /** Filter by category */
    category?: AddressCategory;

    /** Filter by source type */
    sourceType?: AddressLabelSourceType;

    /** Filter by source identifier */
    source?: string;

    /** Filter by tag (matches if any tag matches) */
    tag?: string;

    /** Filter by verified status */
    verified?: boolean;

    /** Minimum confidence score */
    minConfidence?: number;

    /** Text search in label and notes */
    search?: string;
}

/**
 * Result of bulk import operation.
 */
export interface IAddressLabelImportResult {
    /** Number of labels successfully imported */
    imported: number;

    /** Number of labels that were updated (already existed) */
    updated: number;

    /** Number of labels that failed to import */
    failed: number;

    /** Error details for failed imports */
    errors: Array<{ address: string; error: string }>;
}

/**
 * Paginated list result.
 */
export interface IAddressLabelListResult {
    /** Labels for current page */
    labels: IAddressLabel[];

    /** Total count matching filter */
    total: number;

    /** Current page (1-indexed) */
    page: number;

    /** Items per page */
    limit: number;
}

/**
 * Address label service interface.
 *
 * Provides CRUD operations, queries, and bulk operations for address labels.
 * Implementations handle caching, conflict resolution, and source priority.
 */
export interface IAddressLabelService {
    // =========================================================================
    // CRUD Operations
    // =========================================================================

    /**
     * Create a new address label.
     *
     * If a label already exists for this address+source combination,
     * it will be updated instead.
     *
     * @param input - Label creation data
     * @returns Created or updated label
     */
    create(input: ICreateAddressLabelInput): Promise<IAddressLabel>;

    /**
     * Find a label by address.
     *
     * Returns the highest-confidence label if multiple sources exist.
     * Use resolveLabel() to get all labels for an address.
     *
     * @param address - TRON address to look up
     * @returns Label or null if not found
     */
    findByAddress(address: string): Promise<IAddressLabel | null>;

    /**
     * Find labels for multiple addresses efficiently.
     *
     * Used for batch enrichment of transaction lists.
     *
     * @param addresses - Array of TRON addresses
     * @returns Map of address to highest-confidence label
     */
    findByAddresses(addresses: string[]): Promise<Map<string, IAddressLabel>>;

    /**
     * Update an existing label.
     *
     * Only the source that created a label can update it.
     *
     * @param address - Address of label to update
     * @param source - Source identifier (must match original)
     * @param updates - Fields to update
     * @returns Updated label
     * @throws Error if label not found or source mismatch
     */
    update(address: string, source: string, updates: IUpdateAddressLabelInput): Promise<IAddressLabel>;

    /**
     * Delete a label.
     *
     * Only the source that created a label can delete it.
     *
     * @param address - Address of label to delete
     * @param source - Source identifier (must match original)
     * @throws Error if label not found or source mismatch
     */
    delete(address: string, source: string): Promise<void>;

    // =========================================================================
    // Queries
    // =========================================================================

    /**
     * List labels with optional filtering and pagination.
     *
     * @param filter - Optional filter criteria
     * @param page - Page number (1-indexed, default: 1)
     * @param limit - Items per page (default: 50, max: 200)
     * @returns Paginated label list
     */
    list(filter?: IAddressLabelFilter, page?: number, limit?: number): Promise<IAddressLabelListResult>;

    /**
     * Search labels by text query.
     *
     * Searches in label text, notes, and address.
     *
     * @param query - Search text
     * @param limit - Maximum results (default: 20)
     * @returns Matching labels sorted by relevance
     */
    search(query: string, limit?: number): Promise<IAddressLabel[]>;

    /**
     * Resolve the best label for an address considering all sources.
     *
     * Returns the highest-confidence label as primary, with alternates
     * from other sources for transparency.
     *
     * @param address - TRON address to resolve
     * @returns Resolved label with alternates, or null if no labels exist
     */
    resolveLabel(address: string): Promise<IResolvedAddressLabel | null>;

    // =========================================================================
    // Bulk Operations
    // =========================================================================

    /**
     * Import multiple labels in bulk.
     *
     * Uses upsert semantics - existing labels with same address+source
     * are updated, new labels are created.
     *
     * @param labels - Array of labels to import
     * @returns Import result with counts and errors
     */
    importLabels(labels: ICreateAddressLabelInput[]): Promise<IAddressLabelImportResult>;

    /**
     * Export labels matching filter criteria.
     *
     * @param filter - Optional filter criteria
     * @returns All matching labels
     */
    exportLabels(filter?: IAddressLabelFilter): Promise<IAddressLabel[]>;

    // =========================================================================
    // Statistics
    // =========================================================================

    /**
     * Get label statistics for admin dashboard.
     *
     * @returns Counts by category, source type, and verification status
     */
    getStats(): Promise<{
        total: number;
        byCategory: Record<string, number>;
        bySourceType: Record<string, number>;
        verified: number;
        unverified: number;
    }>;
}
