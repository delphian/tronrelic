/**
 * @file ITranslationValueRecord.ts
 *
 * The translated values a content author stores for one item in one language.
 * The author keeps these in its own collection, next to the item itself, and
 * returns them when core asks. Core keeps everything else about the
 * translation — whether it is published, whether it is stale, who changed it,
 * whether it is deleted — in its own collection, so the author stores text and
 * nothing more.
 */

import type { TranslationValues } from './TranslationValues.js';

/**
 * One stored translation's values.
 */
export interface ITranslationValueRecord {
    /** Core content id of the translated item. */
    id: string;

    /** Language code of the translation. */
    language: string;

    /** The translated values, keyed by field name. */
    values: TranslationValues;
}
