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
 * One document per item and language holds the served values and, while a
 * proposal waits for review, the proposed values beside them. A proposal for a
 * language with no saved translation creates a document with no served values,
 * which `read` skips.
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

    /**
     * The served values, keyed by field name. Absent while the language has
     * only a proposal and no saved translation.
     */
    values?: TranslationValues;

    /** When the served values were last written. */
    updatedAt?: Date;

    /** Values proposed for review, held until a curator decides. */
    proposedValues?: TranslationValues;

    /** When the proposed values were written. */
    proposedAt?: Date;
}

/** The field each version lives in, so one read routine serves both. */
type ValueField = 'values' | 'proposedValues';

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
     * Load the served values for a batch of translations in one query.
     *
     * @param keys - The translations to load.
     * @returns One record per translation with served values, in no particular order.
     */
    async read(keys: ReadonlyArray<IContentTranslationKey>): Promise<ITranslationValueRecord[]> {
        return this.readField(keys, 'values');
    }

    /**
     * Store one translation's served values, replacing any stored before.
     * A held proposal is left alone.
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

    /**
     * Load the proposed values held for a batch of translations in one query.
     *
     * @param keys - The translations to load.
     * @returns One record per held proposal, in no particular order.
     */
    async readProposed(keys: ReadonlyArray<IContentTranslationKey>): Promise<ITranslationValueRecord[]> {
        return this.readField(keys, 'proposedValues');
    }

    /**
     * Hold proposed values for one translation, replacing any held before.
     * The served values are left alone, so visitors keep seeing them.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     * @param values - The proposed values.
     * @returns Resolves once the proposal is stored.
     */
    async writeProposed(id: string, language: string, values: TranslationValues): Promise<void> {
        await this.collection.updateOne(
            { contentId: id, language },
            { $set: { proposedValues: values, proposedAt: new Date() } },
            { upsert: true }
        );

        return;
    }

    /**
     * Drop the proposal held for one translation. A document that held only
     * the proposal is removed, so it leaves no empty row behind.
     *
     * @param id - Core content id of the translated item.
     * @param language - Language code of the translation.
     * @returns Resolves once the proposal is gone.
     */
    async clearProposed(id: string, language: string): Promise<void> {
        await this.collection.deleteOne({ contentId: id, language, values: { $exists: false } });
        await this.collection.updateOne(
            { contentId: id, language },
            { $unset: { proposedValues: '', proposedAt: '' } }
        );

        return;
    }

    /**
     * Load one version of a batch of translations, skipping documents that do
     * not hold that version.
     *
     * @param keys - The translations to load.
     * @param field - Which version to read.
     * @returns One record per document holding that version.
     */
    private async readField(keys: ReadonlyArray<IContentTranslationKey>, field: ValueField): Promise<ITranslationValueRecord[]> {
        const wanted = new Set(keys.map((key) => `${key.id}\u0000${key.language}`));
        const ids = Array.from(new Set(keys.map((key) => key.id)));
        const docs = ids.length > 0
            ? await this.collection.find({ contentId: { $in: ids }, [field]: { $exists: true } }).toArray()
            : [];
        const records: ITranslationValueRecord[] = [];
        for (const doc of docs) {
            const values = doc[field];
            if (values && wanted.has(`${doc.contentId}\u0000${doc.language}`)) {
                records.push({ id: doc.contentId, language: doc.language, values });
            }
        }

        return records;
    }
}
