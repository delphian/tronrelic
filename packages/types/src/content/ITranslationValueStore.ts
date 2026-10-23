/**
 * @file ITranslationValueStore.ts
 *
 * Storage for translated values in a content author's own collection.
 *
 * Every translatable content type needs the same few storage steps, so core
 * provides them through `IContentTranslationService.createValueStore` instead
 * of each author writing its own. The store is bound to a collection the author
 * names in the author's own database, so the values stay in the author's
 * storage and core never writes there itself. The author calls the store from
 * its `ITranslatableContentType` methods.
 */

import type { IContentTranslationKey } from './IContentTranslationKey.js';
import type { ITranslationValueRecord } from './ITranslationValueRecord.js';
import type { TranslationValues } from './TranslationValues.js';

/**
 * Reads and writes translated values for one content type.
 */
export interface ITranslationValueStore {
    /**
     * Create the unique index on content id and language. Call once at
     * startup, before the first write. Safe to repeat.
     */
    ensureIndexes(): Promise<void>;

    /**
     * Load the stored values for a batch of translations. A key with no stored
     * values is left out of the result.
     *
     * @param keys - The translations to load.
     * @returns One record per stored translation.
     */
    read(keys: ReadonlyArray<IContentTranslationKey>): Promise<ITranslationValueRecord[]>;

    /**
     * Store the values of one translation, replacing any stored before.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     * @param values - The translated values.
     */
    write(id: string, language: string, values: TranslationValues): Promise<void>;
}
