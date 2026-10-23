/**
 * @fileoverview Translations of managed content — the workflow every
 * translatable content type shares, reached as `IContentService.translations()`.
 *
 * Why it exists: translation used to be built inside the pages module, so every
 * other content type would have needed its own copy of the stale check, the AI
 * Suggest request, the editor, and the list of translated addresses. Core now
 * runs that workflow once for every type whose registration sets
 * `translation`.
 *
 * Storage is split the same way it is for the items themselves. Core keeps the
 * state of each translation — published, the fingerprint of the English text
 * it was written against, who changed it and when, and soft deletion — in its
 * own `content_translations` collection. The content type keeps the translated
 * text in its own collection and reads and writes it through its
 * `ITranslatableContentType` methods. Core never writes the type's collection
 * and never stores the type's text.
 *
 * Translations are not reviewed. Only a curator may change one, and the change
 * is live at once. Every write runs the `content.before*` veto hooks with
 * `language` set, so a rule over all content covers translations too.
 *
 * @see ../../../docs/system/system-content.md — the translations section.
 * @module backend/services/content-translation-service
 */

import { createHash } from 'node:crypto';
import type {
    HookDescriptor,
    IContent,
    IContentActor,
    IContentService,
    IContentTranslation,
    IContentTranslationOverview,
    IContentTranslationService,
    IContentTranslationSettings,
    IContentTranslationStatus,
    IContentTranslationSuggestion,
    IContentTranslationWrite,
    IContentWriteContext,
    IDatabaseService,
    IHookRegistry,
    IManagedContentType,
    IPublicLocalizedRoute,
    IServedContentTranslation,
    ISystemLogService,
    ITranslatableContentType,
    ITranslatableField,
    ITranslationValueRecord,
    ITranslationValueStore,
    TranslationValues
} from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODE_PATTERN, MAX_TRANSLATION_STATUS_IDS } from '@/types';
import { HOOKS } from '../hooks/registry.js';
import { ContentError } from './content-error.js';
import { runContentVeto } from './content-veto.js';
import { ContentTranslationStore } from './content-translation-store.js';
import type { ContentTranslationSettingsService } from './content-translation-settings.js';
import type { ContentTranslationSuggestionService } from './content-translation-suggestion.js';

/** Core collection holding the state of every translation. */
export const CONTENT_TRANSLATIONS_COLLECTION = 'content_translations';

/**
 * Characters that make a path a route pattern in the localization snapshot.
 * A path holding one of them would cover addresses the item is not served at.
 */
const ROUTE_PATTERN_CHARACTERS = /[:*\s]/;

/** A registered managed type together with its translation side. */
interface ITranslatableEntry {
    type: IManagedContentType<IContent, unknown, unknown>;
    translation: ITranslatableContentType<IContent>;
}

/**
 * The state core keeps for one translation. The translated text is not here;
 * the content type stores it.
 */
export interface IContentTranslationStateDocument {
    /** Core content id of the translated item. */
    contentId: string;
    /** The managed content type of the item. */
    typeId: string;
    /** Language code of the translation. */
    language: string;
    /** Whether visitors are served the translation. */
    published: boolean;
    /** Fingerprint of the English text the translation was last saved against. */
    sourceHash: string;
    /** When the translation was first saved. */
    createdAt: Date;
    /** Who first saved it. */
    createdBy: string;
    /** When it was last changed. */
    updatedAt: Date;
    /** Who last changed it. */
    updatedBy: string;
    /** Soft-delete marker; absent while the translation is live. */
    deletedAt?: Date;
    /** Who deleted it; absent while it is live. */
    deletedBy?: string;
}

/** Collaborators the translation service needs, wired by the content service. */
export interface IContentTranslationServiceDependencies {
    /** Core database holding `content_translations`. */
    database: IDatabaseService;
    /** Runs the `content.before*` veto hooks. */
    hookRegistry: IHookRegistry;
    /** Reads items at the version an admin or a visitor sees. */
    reader: Pick<IContentService, 'readAdmin' | 'readPublic'>;
    /** Looks up a registered managed type by id. */
    getType: (typeId: string) => IManagedContentType<IContent, unknown, unknown> | undefined;
    /** Lists every registered managed type. */
    listTypes: () => ReadonlyArray<IManagedContentType<IContent, unknown, unknown>>;
    /** Runs the AI Suggest request. */
    suggestions: Pick<ContentTranslationSuggestionService, 'suggest'>;
    /** Reads and writes the AI settings. */
    settings: Pick<ContentTranslationSettingsService, 'getSettings' | 'updateSettings'>;
    /**
     * Called after a change that can alter which addresses are served in which
     * language, so the localization snapshot is rebuilt.
     */
    onRoutesChanged: () => void;
    /** Scoped logger. */
    logger: ISystemLogService;
}

/**
 * Implements `IContentTranslationService` for every translatable managed type.
 */
export class ContentTranslationService implements IContentTranslationService {
    /**
     * @param deps - Collaborators wired by the content service.
     */
    constructor(private readonly deps: IContentTranslationServiceDependencies) {}

    /**
     * Create the indexes the state collection relies on. Called once at
     * bootstrap with the content service's own indexes.
     *
     * @returns Resolves when every index exists.
     */
    async ensureIndexes(): Promise<void> {
        await this.deps.database.createIndex(CONTENT_TRANSLATIONS_COLLECTION, { contentId: 1, language: 1 }, { unique: true });
        await this.deps.database.createIndex(CONTENT_TRANSLATIONS_COLLECTION, { typeId: 1, published: 1, deletedAt: 1 });
        await this.deps.database.createIndex(CONTENT_TRANSLATIONS_COLLECTION, { typeId: 1, language: 1, published: 1 });

        return;
    }

    // ------------------------------------------------------------------ admin

    /**
     * Load an item's English source and every translation of it.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @returns The source and the translations, ordered by language code.
     */
    async getOverview(typeId: string, id: string): Promise<IContentTranslationOverview> {
        const entry = this.requireTranslatable(typeId);
        const [latest] = await this.deps.reader.readAdmin(typeId, [id]);
        if (!latest) {
            throw new ContentError('not-found', `No ${entry.type.label} with id ${id}`);
        }
        const [served] = await this.deps.reader.readPublic(typeId, [id]);
        const english = entry.translation.extractTranslatable(served ?? latest);
        const englishHash = this.hashValues(entry.translation.translatableFields, english);
        const latestHash = this.hashValues(entry.translation.translatableFields, entry.translation.extractTranslatable(latest));

        const states = await this.collection().find({ contentId: id }).sort({ language: 1 }).toArray();
        const records = states.length > 0
            ? await entry.translation.readTranslations(states.map((state) => ({ id, language: state.language })))
            : [];

        return {
            source: {
                typeId,
                contentId: id,
                fields: [...entry.translation.translatableFields],
                values: english,
                pendingEdit: latest.curation === 'pending' && latestHash !== englishHash
            },
            translations: states.map((state) => this.toTranslation(state, records, englishHash))
        };
    }

    /**
     * Summarize the translations of a batch of items for an admin list. The
     * state rows come from core's own collection in one query; the English
     * text is read only for items that have translations, so the stale flag
     * can be worked out, and the translated text is never read.
     *
     * @param typeId - The managed content type.
     * @param ids - Core content ids of the listed items; at most
     *   `MAX_TRANSLATION_STATUS_IDS` are summarized.
     * @returns Each translated item's statuses, keyed by content id, ordered by language.
     */
    async summarizeTranslations(
        typeId: string,
        ids: ReadonlyArray<string>
    ): Promise<Record<string, IContentTranslationStatus[]>> {
        const entry = this.requireTranslatable(typeId);
        const wanted = Array.from(new Set(ids.map((id) => String(id)))).slice(0, MAX_TRANSLATION_STATUS_IDS);
        const states = wanted.length > 0
            ? await this.collection().find({ contentId: { $in: wanted } }).sort({ language: 1 }).toArray()
            : [];
        const translatedIds = Array.from(new Set(states.map((state) => state.contentId)));
        const englishHashes = await this.englishHashes(entry, translatedIds);

        const summary: Record<string, IContentTranslationStatus[]> = {};
        for (const state of states) {
            const statuses = summary[state.contentId] ?? [];
            statuses.push({
                language: state.language,
                published: state.published,
                stale: state.sourceHash !== englishHashes.get(state.contentId),
                deleted: Boolean(state.deletedAt)
            });
            summary[state.contentId] = statuses;
        }

        return summary;
    }

    /**
     * Create or replace a translation. The values are checked against the
     * type's field list before the veto hooks run, so a hook sees exactly what
     * will be stored.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param input - The translated values and the published switch.
     * @param actor - Who is saving; must be a curator.
     * @returns The saved translation.
     */
    async saveTranslation(
        typeId: string,
        id: string,
        language: string,
        input: IContentTranslationWrite,
        actor: IContentActor
    ): Promise<IContentTranslation> {
        const entry = this.requireTranslatable(typeId);
        this.requireCurator(actor, entry);
        this.requireLanguage(language);
        await this.requireLiveItem(entry, id);
        const existing = await this.findState(id, language);
        if (existing?.deletedAt) {
            throw new ContentError('deleted', `The "${language}" translation is deleted; restore it before changing it`);
        }
        const values = this.validateValues(entry.translation.translatableFields, input?.values);
        const write: IContentTranslationWrite = { values, published: input?.published === true };
        await this.runVeto(HOOKS.content.beforeUpdate, { operation: 'update', typeId, id, actor, input: write, language });

        const englishHash = await this.englishHash(entry, id);
        await entry.translation.writeTranslation(id, language, values);
        const now = new Date();
        await this.collection().updateOne(
            { contentId: id, language },
            {
                $set: { typeId, published: write.published, sourceHash: englishHash, updatedAt: now, updatedBy: actor.id },
                $setOnInsert: { createdAt: now, createdBy: actor.id }
            },
            { upsert: true }
        );
        await this.notifyChanged(entry, id, language);
        this.deps.logger.info({ typeId, id, language, actor: actor.id, published: write.published }, 'Content translation saved');

        return this.readOne(entry, id, language, englishHash);
    }

    /**
     * Soft-delete a translation. The stored values stay for a restore.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param actor - Who is deleting it; must be a curator.
     */
    async deleteTranslation(typeId: string, id: string, language: string, actor: IContentActor): Promise<void> {
        const entry = this.requireTranslatable(typeId);
        this.requireCurator(actor, entry);
        const state = await this.requireState(id, language);
        if (state.deletedAt) {
            throw new ContentError('deleted', `The "${language}" translation is already deleted`);
        }
        await this.runVeto(HOOKS.content.beforeDelete, { operation: 'delete', typeId, id, actor, language });

        const now = new Date();
        await this.collection().updateOne(
            { contentId: id, language },
            { $set: { deletedAt: now, deletedBy: actor.id, updatedAt: now, updatedBy: actor.id } }
        );
        await this.notifyChanged(entry, id, language);
        this.deps.logger.info({ typeId, id, language, actor: actor.id }, 'Content translation soft-deleted');

        return;
    }

    /**
     * Bring back a soft-deleted translation.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param actor - Who is restoring it; must be a curator.
     * @returns The restored translation.
     */
    async restoreTranslation(typeId: string, id: string, language: string, actor: IContentActor): Promise<IContentTranslation> {
        const entry = this.requireTranslatable(typeId);
        this.requireCurator(actor, entry);
        const state = await this.requireState(id, language);
        if (!state.deletedAt) {
            throw new ContentError('not-deleted', `The "${language}" translation is not deleted`);
        }
        await this.runVeto(HOOKS.content.beforeRestore, { operation: 'restore', typeId, id, actor, language });

        await this.collection().updateOne(
            { contentId: id, language },
            { $set: { updatedAt: new Date(), updatedBy: actor.id }, $unset: { deletedAt: '', deletedBy: '' } }
        );
        await this.notifyChanged(entry, id, language);
        this.deps.logger.info({ typeId, id, language, actor: actor.id }, 'Content translation restored');

        return this.readOne(entry, id, language, await this.englishHash(entry, id));
    }

    /**
     * Ask an AI model to translate an item. The existing translation is sent
     * along only when it is stale, so the model updates it instead of
     * starting over.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Target language code.
     * @param actor - Who asked, for the log.
     * @returns The suggested values, the model's notes, and the cost.
     */
    async suggestTranslation(
        typeId: string,
        id: string,
        language: string,
        actor: IContentActor
    ): Promise<IContentTranslationSuggestion> {
        const entry = this.requireTranslatable(typeId);
        await this.requireLiveItem(entry, id);
        const fields = entry.translation.translatableFields;
        const english = entry.translation.extractTranslatable(await this.loadEnglish(entry, id));
        const state = await this.findState(id, language);
        const live = state && !state.deletedAt ? state : null;
        const [record] = live ? await entry.translation.readTranslations([{ id, language }]) : [];
        const existing = record?.values ?? null;
        const stale = live !== null && live.sourceHash !== this.hashValues(fields, english);

        return this.deps.suggestions.suggest(
            { typeId, id, language },
            { fields, english, previous: stale ? existing : null, existing },
            actor.id
        );
    }

    // ----------------------------------------------------------------- public

    /**
     * Read the translation a visitor is served, or null when the item is not
     * visible or the translation is not live and published.
     *
     * @param typeId - The managed content type.
     * @param id - Core content id of the item.
     * @param language - Language code requested.
     * @returns The served item and translated values, or null.
     */
    async readPublicTranslation<T extends IContent>(
        typeId: string,
        id: string,
        language: string
    ): Promise<IServedContentTranslation<T> | null> {
        const entry = this.requireTranslatable(typeId);
        let served: IServedContentTranslation<T> | null = null;
        const state = LANGUAGE_CODE_PATTERN.test(language) && language !== DEFAULT_LANGUAGE
            ? await this.collection().findOne({ contentId: id, language, published: true, deletedAt: { $exists: false } })
            : null;
        if (state) {
            const [item] = await this.deps.reader.readPublic<T>(typeId, [id]);
            const [record] = item ? await entry.translation.readTranslations([{ id, language }]) : [];
            if (item && record) {
                served = { item, language, values: record.values, createdAt: state.createdAt, updatedAt: state.updatedAt };
            }
        }

        return served;
    }

    /**
     * List the items of one type with a published, live translation into a
     * language, for a translated index page.
     *
     * @param typeId - The managed content type.
     * @param language - Language code.
     * @returns Core content ids, in no particular order.
     */
    async listPublishedTranslationIds(typeId: string, language: string): Promise<string[]> {
        this.requireTranslatable(typeId);
        let ids: string[] = [];
        if (LANGUAGE_CODE_PATTERN.test(language) && language !== DEFAULT_LANGUAGE) {
            const states = await this.collection()
                .find(
                    { typeId, language, published: true, deletedAt: { $exists: false } },
                    { projection: { contentId: 1 } }
                )
                .toArray();
            ids = states.map((state) => state.contentId);
        }

        return ids;
    }

    /**
     * List every address with a published, live translation, across all
     * translatable types.
     *
     * @returns One route per address, sorted by path.
     */
    async listLocalizedRoutes(): Promise<IPublicLocalizedRoute[]> {
        const routes = new Map<string, Set<string>>();
        for (const type of this.deps.listTypes()) {
            if (!type.translation) {
                continue;
            }
            const states = await this.collection()
                .find(
                    { typeId: type.typeId, published: true, deletedAt: { $exists: false } },
                    { projection: { contentId: 1, language: 1 } }
                )
                .toArray();
            const languagesById = new Map<string, Set<string>>();
            for (const state of states) {
                const languages = languagesById.get(state.contentId) ?? new Set<string>();
                languages.add(state.language);
                languagesById.set(state.contentId, languages);
            }
            const items = languagesById.size > 0
                ? await this.deps.reader.readPublic(type.typeId, [...languagesById.keys()])
                : [];
            for (const item of items) {
                const languages = languagesById.get(item.id) ?? new Set<string>();
                const paths = type.translation.listPublicPaths(item)
                    .filter((path) => path.startsWith('/') && !ROUTE_PATTERN_CHARACTERS.test(path));
                for (const path of paths) {
                    const merged = routes.get(path) ?? new Set<string>();
                    languages.forEach((language) => merged.add(language));
                    routes.set(path, merged);
                }
            }
        }

        return [...routes.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([pattern, languages]) => ({ pattern, languages: [...languages].sort() }));
    }

    // --------------------------------------------------------------- settings

    /**
     * Read the AI settings for translation suggestions.
     *
     * @returns The settings.
     */
    async getSettings(): Promise<IContentTranslationSettings> {
        return this.deps.settings.getSettings();
    }

    /**
     * Change the AI settings for translation suggestions.
     *
     * @param updates - The fields to change.
     * @returns The settings after the change.
     */
    async updateSettings(
        updates: Partial<Omit<IContentTranslationSettings, 'updatedAt'>>
    ): Promise<IContentTranslationSettings> {
        return this.deps.settings.updateSettings(updates);
    }

    /**
     * Build the store a content type keeps its translated values in.
     *
     * @param database - The content type's own database.
     * @param collectionName - The collection to keep values in.
     * @returns The store.
     */
    createValueStore(database: IDatabaseService, collectionName: string): ITranslationValueStore {
        return new ContentTranslationStore(database, collectionName);
    }

    // -------------------------------------------------------------- internals

    /**
     * The typed handle on the state collection.
     *
     * @returns The `content_translations` collection.
     */
    private collection() {
        return this.deps.database.getCollection<IContentTranslationStateDocument>(CONTENT_TRANSLATIONS_COLLECTION);
    }

    /**
     * Resolve a registered type that takes part in translation.
     *
     * @param typeId - The managed content type id.
     * @returns The type and its translation side.
     * @throws ContentError `unknown-type` when the type is not registered or not translatable.
     */
    private requireTranslatable(typeId: string): ITranslatableEntry {
        const type = this.deps.getType(typeId);
        if (!type?.translation) {
            throw new ContentError('unknown-type', `No translatable managed content type registered for '${typeId}'`);
        }

        return { type, translation: type.translation };
    }

    /**
     * Refuse a translation write from anyone but a curator. Translations are
     * not reviewed, so letting anyone else write one would put unchecked text
     * in front of visitors.
     *
     * @param actor - Who is writing.
     * @param entry - The type, named in the refusal.
     * @throws ContentError `forbidden` for a non-curator.
     */
    private requireCurator(actor: IContentActor, entry: ITranslatableEntry): void {
        if (!actor.isCurator) {
            throw new ContentError('forbidden', `Only a curator may change translations of a ${entry.type.label}`);
        }

        return;
    }

    /**
     * Check a translation's language code. The item itself is the default
     * language, so a translation into it would compete with the item for the
     * same address.
     *
     * @param language - The caller's language code.
     * @throws Error when it is malformed or the default language.
     */
    private requireLanguage(language: string): void {
        if (!LANGUAGE_CODE_PATTERN.test(language)) {
            throw new Error(`"${language}" is not a valid language code`);
        }
        if (language === DEFAULT_LANGUAGE) {
            throw new Error(`The item itself is the "${DEFAULT_LANGUAGE}" version; a translation needs another language`);
        }

        return;
    }

    /**
     * Confirm an item exists and is not deleted before writing to it.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @throws ContentError `not-found` or `deleted`.
     */
    private async requireLiveItem(entry: ITranslatableEntry, id: string): Promise<void> {
        const [item] = await this.deps.reader.readAdmin(entry.type.typeId, [id]);
        if (!item) {
            throw new ContentError('not-found', `No ${entry.type.label} with id ${id}`);
        }
        if (item.deletedAt) {
            throw new ContentError('deleted', `The ${entry.type.label} is deleted; restore it before translating it`);
        }

        return;
    }

    /**
     * Load a translation's state.
     *
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @returns The state, or null when the item has no translation into that language.
     */
    private async findState(id: string, language: string): Promise<IContentTranslationStateDocument | null> {
        return this.collection().findOne({ contentId: id, language }, { projection: { _id: 0 } });
    }

    /**
     * Load a translation's state that the caller expects to exist.
     *
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @returns The state.
     * @throws ContentError `not-found` when there is no such translation.
     */
    private async requireState(id: string, language: string): Promise<IContentTranslationStateDocument> {
        const state = await this.findState(id, language);
        if (!state) {
            throw new ContentError('not-found', `This item has no translation into "${language}"`);
        }

        return state;
    }

    /**
     * Load the English text translators work from: the version visitors are
     * served, or the latest edit when no version is served yet. The editor,
     * the Suggest request, and the stale check all use this, so a translator
     * works from the same text the stale check compares with.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @returns The item at that version.
     * @throws ContentError `not-found` when no item has that id.
     */
    private async loadEnglish(entry: ITranslatableEntry, id: string): Promise<IContent> {
        const [served] = await this.deps.reader.readPublic(entry.type.typeId, [id]);
        const [latest] = served ? [served] : await this.deps.reader.readAdmin(entry.type.typeId, [id]);
        if (!latest) {
            throw new ContentError('not-found', `No ${entry.type.label} with id ${id}`);
        }

        return latest;
    }

    /**
     * Fingerprint the English text a translation is written against.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @returns A SHA-256 hex digest.
     */
    private async englishHash(entry: ITranslatableEntry, id: string): Promise<string> {
        const english = entry.translation.extractTranslatable(await this.loadEnglish(entry, id));

        return this.hashValues(entry.translation.translatableFields, english);
    }

    /**
     * Fingerprint the English text of a batch of items in two reads, the same
     * version rule `loadEnglish` applies one item at a time: the version
     * visitors are served, else the latest edit.
     *
     * @param entry - The managed type.
     * @param ids - Core content ids of the items.
     * @returns Each found item's fingerprint, keyed by content id.
     */
    private async englishHashes(entry: ITranslatableEntry, ids: ReadonlyArray<string>): Promise<Map<string, string>> {
        const hashes = new Map<string, string>();
        if (ids.length > 0) {
            const served = await this.deps.reader.readPublic(entry.type.typeId, ids);
            const servedIds = new Set(served.map((item) => item.id));
            const unserved = ids.filter((id) => !servedIds.has(id));
            const latest = unserved.length > 0 ? await this.deps.reader.readAdmin(entry.type.typeId, unserved) : [];
            for (const item of [...served, ...latest]) {
                hashes.set(item.id, this.hashValues(entry.translation.translatableFields, entry.translation.extractTranslatable(item)));
            }
        }

        return hashes;
    }

    /**
     * Fingerprint the translatable text, so two loads of the same English
     * always produce the same value and any change to it produces another.
     * `url` fields are left out: changing an image is not a change a
     * translator has to follow. The values are hashed as one object in field
     * order, so a type that appends a field changes every fingerprint once
     * and a type that keeps its fields keeps its fingerprints.
     *
     * @param fields - The type's translatable fields.
     * @param values - The values to fingerprint.
     * @returns A SHA-256 hex digest.
     */
    private hashValues(fields: ReadonlyArray<ITranslatableField>, values: TranslationValues): string {
        const text: TranslationValues = {};
        for (const field of fields) {
            if (field.kind !== 'url') {
                text[field.name] = values[field.name] ?? (field.kind === 'string-list' ? [] : '');
            }
        }

        return createHash('sha256').update(JSON.stringify(text)).digest('hex');
    }

    /**
     * Check a caller's values against the type's field list and reduce them
     * to exactly the declared fields. Single-line text and lists are trimmed;
     * Markdown and multi-line text keep their whitespace.
     *
     * @param fields - The type's translatable fields.
     * @param raw - The caller's values.
     * @returns One value per declared field.
     * @throws Error when a value has the wrong shape or a required one is empty.
     */
    private validateValues(fields: ReadonlyArray<ITranslatableField>, raw: unknown): TranslationValues {
        const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        const values: TranslationValues = {};
        for (const field of fields) {
            const value = input[field.name];
            let empty: boolean;
            if (field.kind === 'string-list') {
                if (value !== undefined && !(Array.isArray(value) && value.every((entry) => typeof entry === 'string'))) {
                    throw new Error(`${field.label} must be a list of text`);
                }
                const list = ((value as string[] | undefined) ?? []).map((entry) => entry.trim()).filter((entry) => entry !== '');
                values[field.name] = list;
                empty = list.length === 0;
            } else {
                if (value !== undefined && typeof value !== 'string') {
                    throw new Error(`${field.label} must be text`);
                }
                const text = typeof value === 'string' ? value : '';
                values[field.name] = field.kind === 'text' || field.kind === 'url' ? text.trim() : text;
                empty = text.trim() === '';
            }
            if (field.required && empty) {
                throw new Error(`${field.label} is required`);
            }
        }

        return values;
    }

    /**
     * Tell the content type and the localization snapshot that a translation
     * changed. A failure in the type's cache handling is logged, not thrown,
     * because the change itself is already stored.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     */
    private async notifyChanged(entry: ITranslatableEntry, id: string, language: string): Promise<void> {
        try {
            await entry.translation.onTranslationChanged(id, language);
        } catch (error) {
            this.deps.logger.warn({ error, typeId: entry.type.typeId, id, language }, 'Content type failed to react to a translation change');
        }
        this.deps.onRoutesChanged();

        return;
    }

    /**
     * Load one translation for returning from a write.
     *
     * @param entry - The managed type.
     * @param id - Core content id of the item.
     * @param language - Language code of the translation.
     * @param englishHash - Fingerprint of the English text as it is now.
     * @returns The translation.
     */
    private async readOne(
        entry: ITranslatableEntry,
        id: string,
        language: string,
        englishHash: string
    ): Promise<IContentTranslation> {
        const state = await this.requireState(id, language);
        const records = await entry.translation.readTranslations([{ id, language }]);

        return this.toTranslation(state, records, englishHash);
    }

    /**
     * Join a translation's state with its stored values.
     *
     * @param state - The state core keeps.
     * @param records - Values the content type returned; the matching one is used.
     * @param englishHash - Fingerprint of the English text as it is now.
     * @returns The translation, flagged stale when it was written against different English text.
     */
    private toTranslation(
        state: IContentTranslationStateDocument,
        records: ReadonlyArray<ITranslationValueRecord>,
        englishHash: string
    ): IContentTranslation {
        const record = records.find((candidate) => candidate.id === state.contentId && candidate.language === state.language);

        return {
            typeId: state.typeId,
            contentId: state.contentId,
            language: state.language,
            values: record?.values ?? {},
            published: state.published,
            stale: state.sourceHash !== englishHash,
            ...(state.deletedAt ? { deletedAt: state.deletedAt } : {}),
            createdAt: state.createdAt,
            createdBy: state.createdBy,
            updatedAt: state.updatedAt,
            updatedBy: state.updatedBy
        };
    }

    /**
     * Run one of the `content.before*` veto hooks for a translation write.
     *
     * @param descriptor - The hook to run.
     * @param context - What is about to happen, with `language` set.
     * @throws ContentError `vetoed` when a handler aborts.
     */
    private async runVeto(
        descriptor: HookDescriptor<IContentWriteContext, void, 'series'>,
        context: IContentWriteContext
    ): Promise<void> {
        await runContentVeto(this.deps.hookRegistry, descriptor, context);

        return;
    }
}
