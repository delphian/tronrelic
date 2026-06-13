import type { ITransactionPersistencePayload } from './ITransactionPersistencePayload.js';
import type { ITransactionCategoryFlags } from './ITransactionCategoryFlags.js';

/**
 * Enriched transaction ready for observer processing.
 *
 * This is the complete transaction object that observers receive after the blockchain
 * service has parsed raw TronGrid data, enriched it with USD prices, categorized it,
 * and prepared both database and real-time representations. Observers never see raw
 * blockchain data, only this structured, framework-independent format.
 *
 * NOTE: This is the observer-delivery *pipeline envelope*, not a source-independent
 * domain contract. `rawValue`, `info`, and `snapshot` carry provider- and
 * transport-shaped data, so this type must never be used as the return shape of a
 * blockchain read. New read methods return `IBlockTransaction` instead. See
 * `docs/system/system-domain-types.md` for the distinction.
 */
export interface ITransaction {
    /** Complete transaction data ready for database persistence */
    payload: ITransactionPersistencePayload;
    /** Socket.IO-ready representation for real-time client notifications (uses any to allow for shared package types) */
    snapshot: any;
    /** Boolean flags for efficient transaction categorization and routing */
    categories: ITransactionCategoryFlags;
    /** Original contract parameter values from TronGrid API */
    rawValue: Record<string, unknown>;
    /** Transaction receipt with energy/bandwidth execution details (may be null, format varies by blockchain provider) */
    info: any;
}
