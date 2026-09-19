/**
 * @file IContentPayloadRecord.ts
 *
 * The minimum shape of a record a content author stores in its own
 * collection. Core cannot reach into a plugin's collection, so it cannot
 * enforce this; the content contract requires it, and every managed content
 * author is expected to follow it.
 *
 * Soft deletion is the reason this exists. Deleting managed content never
 * removes data — not from core's collection and not from the author's — so a
 * restore can bring the item back whole and the audit trail stays complete.
 */

/**
 * Fields every author-owned content record carries alongside its own data.
 */
export interface IContentPayloadRecord {
    /** The core-issued content id this record belongs to. */
    contentId: string;

    /**
     * When the item was soft-deleted, or null while it is live. The author
     * sets it in its `delete` callback and clears it in `restore`, and never
     * removes the record.
     */
    deletedAt: Date | null;
}
