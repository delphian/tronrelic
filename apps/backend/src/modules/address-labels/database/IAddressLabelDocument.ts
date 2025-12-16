/**
 * Address label MongoDB document interface.
 *
 * Internal document type for MongoDB storage. The public API uses
 * IAddressLabel from @tronrelic/types which excludes the MongoDB _id.
 *
 * ## Design Decisions
 *
 * - **Compound index on address+source**: Enables multiple sources to label
 *   the same address while ensuring uniqueness per source
 * - **Timestamps for audit**: createdAt/updatedAt enable change tracking
 * - **Denormalized for performance**: All data in single document, no joins
 */

import type { ObjectId } from 'mongodb';
import type { AddressCategory, AddressLabelSourceType, ITronAddressMetadata } from '@tronrelic/types';

/**
 * MongoDB document structure for address labels.
 */
export interface IAddressLabelDocument {
    /** MongoDB internal ID */
    _id: ObjectId;

    /** TRON address (base58 format starting with T) */
    address: string;

    /** Human-readable label */
    label: string;

    /** Primary category */
    category: AddressCategory;

    /** Additional classification tags */
    tags: string[];

    /** Source identifier (e.g., "tronscan", "user:uuid", "plugin:whale-alerts") */
    source: string;

    /** Type of source */
    sourceType: AddressLabelSourceType;

    /** Confidence score 0-100 */
    confidence: number;

    /** Whether manually verified */
    verified: boolean;

    /** TRON-specific metadata */
    tronMetadata?: ITronAddressMetadata;

    /** Additional context or notes */
    notes?: string;

    /** Extensible metadata */
    customMetadata?: Record<string, unknown>;

    /** Creation timestamp */
    createdAt: Date;

    /** Last update timestamp */
    updatedAt: Date;
}
