/**
 * @file ContentCurationState.ts
 *
 * The review state core records for one managed content item. Core is the
 * only writer of this value: it lives on the core content row, never on the
 * content author's own record, so no plugin or module can mark its own content
 * approved.
 *
 * The state describes the item's *working* version — the latest edit. An item
 * that was approved earlier and then edited is `pending` while the edit waits
 * for review, and the author keeps serving the earlier approved version in the
 * meantime (see `IContent.hasApprovedVersion`). An item whose type declares no
 * reviewed fields, or that has never had a reviewed field written by a
 * non-curator, carries no state at all.
 */

/**
 * `pending` — a non-curator changed a reviewed field and the change waits in
 * the curation queue. `approved` — a curator approved the working version (or
 * wrote it themselves). `rejected` — a curator rejected the working version;
 * any earlier approved version keeps being served.
 */
export type ContentCurationState = 'pending' | 'approved' | 'rejected';
