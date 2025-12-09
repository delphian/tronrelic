/**
 * Address book entry mapping TRON addresses to human-readable names.
 *
 * Provides display names for known addresses including energy rental pools,
 * exchanges, and notable accounts. Without this, pool names display as raw
 * 34-character addresses in the UI.
 *
 * Seed data is populated during plugin installation and can be extended
 * via the admin UI.
 */
export interface IAddressBookEntry {
    /** TRON address in Base58 format */
    address: string;
    /** Human-readable display name */
    name: string;
    /** Optional category for grouping (e.g., "pool", "exchange", "notable") */
    category?: 'pool' | 'exchange' | 'notable' | 'other';
    /** When this entry was added */
    createdAt?: Date;
    /** When this entry was last updated */
    updatedAt?: Date;
}
