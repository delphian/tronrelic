/**
 * @fileoverview Storage for what machine sources say their tags mean.
 *
 * A tag's text is short and easy to misread, so a source can store one
 * meaning per tag it writes, and readers show it beside the tag. Definitions
 * are kept apart from the tag assignments because a meaning belongs to the
 * tag text, not to each address: one sentence explains every address that
 * carries `market:catfee:pool-wallet`, and rewording it is one write rather
 * than a rewrite of every assignment.
 *
 * This class only stores. `AddressTagService` validates every definition
 * before it reaches here, so tag text is still checked in one place.
 */

import type { IAddressTagDefinition, IAddressTagSourceDefinition, IDatabaseService } from '@/types';

/** Physical collection name, following the `module_{id}_{collection}` convention. */
export const ADDRESS_TAG_DEFINITIONS_COLLECTION = 'module_address-tags_definitions';

/** Stored document shape: one definition of one tag by one source. */
interface IAddressTagDefinitionDocument {
    source: string;
    tag: string;
    meaning: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Reads and replaces tag definitions in their own collection.
 *
 * A utility owned by `AddressTagService`, which constructs it with the
 * database it was given, rather than a service of its own; the published
 * contract stays `IAddressTagService`.
 */
export class AddressTagDefinitionStore {
    /**
     * @param database - Core database service the definitions are stored through.
     */
    constructor(private readonly database: IDatabaseService) {}

    /**
     * Create the unique per-source index and the lookup-by-tag index.
     *
     * Called from the service's `ensureIndexes`. The unique index is what
     * makes a source's rewrite of a definition an update rather than a
     * second copy.
     */
    public async ensureIndexes(): Promise<void> {
        await this.database.createIndex(ADDRESS_TAG_DEFINITIONS_COLLECTION, { source: 1, tag: 1 }, { unique: true });
        await this.database.createIndex(ADDRESS_TAG_DEFINITIONS_COLLECTION, { tag: 1, source: 1 }, {});
    }

    /**
     * Make one source's stored definitions exactly the given set.
     *
     * Each definition is upserted, keeping `createdAt` from its first write,
     * and every stored definition of this source whose tag is not in the set
     * is deleted, so a source that stops writing a tag stops explaining it.
     *
     * @param source - The source whose definitions are replaced.
     * @param definitions - Already-validated definitions, one per tag.
     * @param now - The pass's single timestamp.
     * @returns How many stored definitions were removed.
     */
    public async replace(source: string, definitions: IAddressTagDefinition[], now: Date): Promise<number> {
        const collection = this.database.getCollection<IAddressTagDefinitionDocument>(ADDRESS_TAG_DEFINITIONS_COLLECTION);
        for (const definition of definitions) {
            await collection.updateOne(
                { source, tag: definition.tag },
                {
                    $set: { meaning: definition.meaning, updatedAt: now },
                    $setOnInsert: { source, tag: definition.tag, createdAt: now }
                },
                { upsert: true }
            );
        }
        return this.database.deleteMany(ADDRESS_TAG_DEFINITIONS_COLLECTION, {
            source,
            tag: { $nin: definitions.map(definition => definition.tag) }
        });
    }

    /**
     * Every stored definition of the given tags, whichever source wrote it.
     *
     * @param tags - Already-validated, distinct tag values.
     * @returns The definitions, ordered by tag then source.
     */
    public async findByTags(tags: string[]): Promise<IAddressTagSourceDefinition[]> {
        let definitions: IAddressTagSourceDefinition[] = [];
        if (tags.length > 0) {
            const collection = this.database.getCollection<IAddressTagDefinitionDocument>(ADDRESS_TAG_DEFINITIONS_COLLECTION);
            const docs = await collection.find({ tag: { $in: tags } }).sort({ tag: 1, source: 1 }).toArray();
            definitions = docs.map(doc => ({ source: doc.source, tag: doc.tag, meaning: doc.meaning, updatedAt: doc.updatedAt }));
        }
        return definitions;
    }
}
