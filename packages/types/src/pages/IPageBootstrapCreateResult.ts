/**
 * @fileoverview What a bootstrap create answered.
 */

import type { IPageBootstrapRow } from './IPageBootstrapRow.js';
import type { PageBootstrapRefusalReason } from './PageBootstrapRefusalReason.js';

/**
 * The outcome of `IPageBootstrapCatalog.create`. A refusal the admin should
 * read is returned rather than thrown, because a plugin cannot recognise
 * core's error classes; only a failure with no known cause is thrown.
 */
export type IPageBootstrapCreateResult =
    | {
        /** The page was proposed and waits in the curation queue. */
        created: true;
        /** The entry's row after the proposal, now in the `pending` state. */
        row: IPageBootstrapRow;
        /** The curation queue item holding the page. */
        curationId: string;
    }
    | {
        /** Nothing was written. */
        created: false;
        /** Why, for the route to map to a status with `PAGE_BOOTSTRAP_REFUSAL_STATUS`. */
        reason: PageBootstrapRefusalReason;
        /** What happened, phrased to be shown to the admin. */
        message: string;
    };
