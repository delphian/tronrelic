/**
 * @file IContentTranslationOverview.ts
 *
 * Everything the translation editor loads for one item at once: the English
 * source and every translation of it. Returned together so the editor never
 * shows stale flags computed against different English text than it displays.
 */

import type { IContentTranslation } from './IContentTranslation.js';
import type { IContentTranslationSource } from './IContentTranslationSource.js';

/**
 * One item's English source and its translations.
 */
export interface IContentTranslationOverview {
    /** The English text the translations follow. */
    source: IContentTranslationSource;

    /** Every translation, including soft-deleted ones, ordered by language code. */
    translations: IContentTranslation[];
}
