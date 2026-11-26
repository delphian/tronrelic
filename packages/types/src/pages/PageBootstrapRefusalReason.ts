/**
 * @fileoverview Why a bootstrap page was not created.
 */

/**
 * The reason a catalog's `create` refused, so the admin route serving it can
 * answer with the right status. `PAGE_BOOTSTRAP_REFUSAL_STATUS` maps each
 * reason to that status, so every Bootstrap tab answers the same refusal the
 * same way.
 *
 * - `unknown-entry` — the catalog has no entry with that id.
 * - `address-held` — a page already holds the address, including a deleted
 *   or rejected one, or the pages module refused the address when two
 *   clicks raced past the check.
 * - `invalid-proposal` — the pages module refused one of the proposal's
 *   fields, which points at a mistake in the entry itself.
 * - `vetoed` — a `content.beforeCreate` hook refused the page.
 * - `curation-unavailable` — the curation queue is not running, so the page
 *   was refused rather than created unreviewed.
 */
export type PageBootstrapRefusalReason =
    | 'unknown-entry'
    | 'address-held'
    | 'invalid-proposal'
    | 'vetoed'
    | 'curation-unavailable';
