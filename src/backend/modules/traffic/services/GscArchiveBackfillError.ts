/**
 * @fileoverview Why an archive backfill request was refused.
 *
 * The admin route answers each refusal with a different HTTP status, so the
 * reason travels as a `code` the controller branches on instead of being
 * parsed out of the message.
 */

/**
 * Reasons `GscArchiveBackfill.start` refuses a request:
 * - `archive-disabled` — the deployment has no ClickHouse.
 * - `not-configured` — Search Console credentials are not stored.
 * - `already-running` — a backfill is in progress in this process.
 * - `invalid-range` — the dates are malformed, reversed, in the future, or too wide.
 */
export type GscArchiveBackfillErrorCode = 'archive-disabled' | 'not-configured' | 'already-running' | 'invalid-range';

/**
 * Refusal raised before a backfill starts, carrying the reason as a code.
 */
export class GscArchiveBackfillError extends Error {
    /**
     * @param code - The reason, which picks the HTTP status.
     * @param message - Explanation shown to the operator.
     */
    constructor(readonly code: GscArchiveBackfillErrorCode, message: string) {
        super(message);
        this.name = 'GscArchiveBackfillError';
    }
}
