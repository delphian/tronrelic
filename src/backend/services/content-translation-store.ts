/**
 * @fileoverview The store content types keep their translated values in.
 *
 * Every translatable content type needs to save and load translated text by
 * content id and language. Writing that once here keeps the types from each
 * carrying a copy that drifts apart. The store is bound to a collection the
 * content type names in the content type's own database, so the translated
 * text stays in the type's storage: core hands out the code, and the type
 * decides where it runs and calls it from its own `ITranslatableContentType`
 * methods. Core's own state for each translation lives in
 * `content_translations` and never here.
 *
 * @module backend/services/content-translation-store
 */

import type { Collection } from 'mongodb';
import type {
    IContentTranslationKey,
    IDatabaseService,
    ITranslationValueRecord,
    ITranslationValueStore,
    TranslationValues
} from '@/types';

/**
 * One stored translation in a content type's value collection.
 */
export interface ITranslationValueDocument {
    /** Core content id of the translated item. */
    contentId: string;

    /** Language code of the translation. */
    language: string;

    /** The translated values, keyed by field name. */
    values: TranslationValues;

    /** When the values were last written. */
    updatedAt: Date;
}

/**
 * Translated values in one content type's collection.
 */
export class ContentTranslationStore implements ITranslationValueStore {
    private readonly collection: Collection<ITranslationValueDocument>;

    /**
     * @param database - The content type's own database, so a plugin's
     *   collection is prefixed and scoped the way all its storage is.
     * @param collectionName - The collection the content type named for its values.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly collectionName: string
    ) {
        this.collection = database.getCollection<ITranslationValueDocument>(collectionName);
    }

    /**
     * Create the unique index on content id and language, which is what holds
     * an item to one translation per language even when two saves race.
     *
     * @returns Resolves once the index exists.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(this.collectionName, { contentId: 1, language: 1 }, { unique: true });

        return;
    }

    /**
     * Load the stored values for a batch of translations in one query.
     *
     * @param keys - The translations to load.
     * @returns One record per stored translation, in no particular order.
     */
    async read(keys: ReadonlyArray<IContentTranslationKey>): Promise<ITranslationValueRecord[]> {
        const wanted = new Set(keys.map((key) => `${key.id}\u0000${key.language}`));
        const ids = Array.from(new Set(keys.map((key) => key.id)));
        const docs = ids.length > 0
            ? await this.collection.find({ contentId: { $in: ids } }).toArray()
            : [];

        return docs
            .filter((doc) => wanted.has(`${doc.contentId}\u0000${doc.language}`))
            .map((doc) => ({ id: doc.contentId, language: doc.language, values: doc.values }));
    }

    /**
     * Store one translation's values, replacing any stored before.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     * @param values - The translated values.
     * @returns Resolves once the values are stored.
     */
    async write(id: string, language: string, values: TranslationValues): Promise<void> {
        await this.collection.updateOne(
            { contentId: id, language },
            { $set: { values, updatedAt: new Date() } },
            { upsert: true }
        );

        return;
    }
}
