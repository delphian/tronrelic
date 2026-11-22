/**
 * @file IContentTranslationWrite.ts
 *
 * What a caller sends to save a translation. The same shape creates a new
 * translation and replaces an existing one, because an item has at most one
 * translation per language and saving is the only change a translator makes.
 */

import type { TranslationValues } from './TranslationValues.js';

/**
 * The translated values and the published switch for one save.
 */
export interface IContentTranslationWrite {
    /** The translated values, one per declared field. */
    values: TranslationValues;

    /** Whether visitors are served the translation once it is saved. */
    published: boolean;

    /**
     * Whether the translation is custom: kept for its own readers rather than
     * in step with the English, and so never flagged stale. Absent keeps the
     * translation's current setting, which is off for a new translation.
     */
    custom?: boolean;
}
