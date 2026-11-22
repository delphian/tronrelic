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
 *
 * Each stored translation can also hold a proposed version beside the served
 * one, for a translation proposed by someone who is not a curator and waiting
 * for review. Writing one never touches the other.
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
     * Load the served values for a batch of translations. A key with no served
     * values, including one that holds only a proposal, is left out of the result.
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

    /**
     * Load the proposed values held for a batch of translations. A key with
     * no proposal is left out of the result.
     *
     * @param keys - The translations to load.
     * @returns One record per held proposal.
     */
    readProposed(keys: ReadonlyArray<IContentTranslationKey>): Promise<ITranslationValueRecord[]>;

    /**
     * Hold proposed values for one translation, replacing any proposal held
     * before and leaving the served values as they are.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     * @param values - The proposed values.
     */
    writeProposed(id: string, language: string, values: TranslationValues): Promise<void>;

    /**
     * Drop the proposal held for one translation. Does nothing when none is held.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     */
    clearProposed(id: string, language: string): Promise<void>;
}
