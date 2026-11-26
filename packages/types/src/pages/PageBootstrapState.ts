/**
 * @fileoverview Where a page a component offers to create currently stands.
 */

/**
 * The state of the address a bootstrap page would take, as an admin page's
 * Bootstrap tab shows it.
 *
 * - `absent` — no page holds the address, so the page can be created.
 * - `pending` — a page holds it and its only version waits in the curation queue.
 * - `approved` — a curator has approved a version of the page holding it.
 * - `draft` — the page holding it was never reviewed and is not published.
 * - `rejected` — the page holding it was rejected and has no approved version.
 * - `deleted` — the page holding it is soft-deleted; deleted pages keep their address.
 * - `redirect` — another page lists the address in its redirect history.
 *
 * Every state but `absent` means the pages module would refuse a new page at
 * the address.
 */
export type PageBootstrapState = 'absent' | 'pending' | 'approved' | 'draft' | 'rejected' | 'deleted' | 'redirect';
