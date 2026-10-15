/**
 * @fileoverview One page of the translation listing.
 */

import type { ITranslationRow } from './ITranslationRow.js';

/**
 * The rows the Translations tab shows plus the total matching the filter, so
 * the table can page through a large namespace without loading all of it.
 */
export interface ITranslationPage {
    /** Rows for the requested page. */
    rows: ITranslationRow[];

    /** Number of keys matching the filter across all pages. */
    total: number;
}
