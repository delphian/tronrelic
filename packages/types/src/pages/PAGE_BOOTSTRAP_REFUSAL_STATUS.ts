/**
 * @fileoverview The HTTP status each bootstrap refusal is answered with.
 *
 * A module and a plugin both serve a Bootstrap tab, and a plugin cannot
 * import core's error classes to map a refusal itself. Keeping the mapping
 * here gives every Bootstrap endpoint the same status for the same reason.
 */

import type { PageBootstrapRefusalReason } from './PageBootstrapRefusalReason.js';

/**
 * Status per refusal reason. `address-held` and `invalid-proposal` are both
 * conflicts with existing pages or the address rules; `curation-unavailable`
 * is 503 because retrying later can succeed once the queue is running.
 */
export const PAGE_BOOTSTRAP_REFUSAL_STATUS: Readonly<Record<PageBootstrapRefusalReason, number>> = {
    'unknown-entry': 404,
    'address-held': 409,
    'invalid-proposal': 409,
    vetoed: 403,
    'curation-unavailable': 503
};
