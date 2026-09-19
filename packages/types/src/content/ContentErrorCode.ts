/**
 * @file ContentErrorCode.ts
 *
 * The reasons the core content service refuses an operation. The service
 * throws an Error carrying one of these in its `code` property so a caller —
 * an admin route mapping to an HTTP status, a plugin deciding whether to retry
 * — can branch on the reason without parsing the message.
 */

/**
 * `unknown-type` — no managed content type is registered under the id.
 * `not-found` — no item with that id exists for the type.
 * `deleted` — the item is soft-deleted and must be restored first.
 * `not-deleted` — a restore was asked for an item that is not deleted.
 * `vetoed` — a `content.before*` hook handler stopped the operation.
 * `curation-unavailable` — the change needs review but the curation service
 *   is not running, so it is refused rather than written unreviewed.
 * `superseded` — a curator approved a queue item that no longer holds the
 *   item's current edit, so nothing was promoted.
 */
export type ContentErrorCode =
    | 'unknown-type'
    | 'not-found'
    | 'deleted'
    | 'not-deleted'
    | 'vetoed'
    | 'curation-unavailable'
    | 'superseded';
