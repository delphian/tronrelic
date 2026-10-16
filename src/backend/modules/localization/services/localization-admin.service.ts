/**
 * @fileoverview Management of languages, published routes, keys, and
 * translations for the `/system/localization` admin page.
 *
 * This is the write side of the module. Every method that changes what
 * visitors see calls the injected `onChange` callback, which clears the read
 * side's in-memory snapshot so the change shows on the next page render. The
 * HTTP controller is a thin wrapper over these methods; all validation lives
 * here so a future caller other than the controller gets the same rules.
 */

import { ObjectId } from 'mongodb';
import type {
    IDatabaseService,
    ILanguage,
    ILanguageSummary,
    ILocalizedRoute,
    ILocalizedRouteSummary,
    ISystemLogService,
    ITranslation,
    ITranslationKey,
    ITranslationNamespaceSummary,
    ITranslationPage,
    ITranslationRow,
    LanguageDirection,
    TranslationStatus
} from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODE_PATTERN, PLUGIN_ID_PATTERN, isValidRoutePattern, matchRoutePattern } from '@/types';
import type { ILanguageDocument, ILocalizedRouteDocument, ITranslationDocument, ITranslationKeyDocument } from '../database/index.js';
import { KEYS_COLLECTION, LANGUAGES_COLLECTION, ROUTES_COLLECTION, TRANSLATIONS_COLLECTION } from '../database/index.js';
import { LocalizationConflictError, LocalizationNotFoundError, LocalizationValidationError } from './localization-errors.js';
import { CORE_NAMESPACE, KEY_PATTERN, MAX_SOURCE_LENGTH, MAX_TRANSLATION_LENGTH, joinKeyId } from './translation-key-rules.js';

/** Longest language name accepted, in either form. */
const MAX_NAME_LENGTH = 80;

/** Default and largest page size for the translation listing. */
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

/**
 * Most translations one batch save accepts. Matches the largest listing page,
 * since the Translations tab saves at most the page it shows.
 */
const MAX_BATCH_SAVE = MAX_PAGE_SIZE;

/** How many conflicting paths an enable refusal names before summarising. */
const MAX_CONFLICTS_REPORTED = 5;

/** Fields an administrator supplies when adding a language. */
export interface ILanguageInput {
    /** BCP 47 code. */
    code: string;
    /** English name. */
    name: string;
    /** Name in the language itself. */
    nativeName: string;
    /** Script direction; defaults to `ltr`. */
    direction?: LanguageDirection;
}

/** Fields an administrator may change on an existing language. */
export interface ILanguagePatch {
    /** New English name. */
    name?: string;
    /** New native name. */
    nativeName?: string;
    /** New script direction. */
    direction?: LanguageDirection;
    /** Switch the language on or off for visitors. */
    enabled?: boolean;
}

/** Fields for creating or replacing a published route. */
export interface IRouteInput {
    /** Route pattern. */
    pattern: string;
    /** Languages to publish it in. */
    languages: string[];
}

/** Filter for the paged translation listing. */
export interface ITranslationListQuery {
    /** Language whose translations to show; required. */
    language: string;
    /** Restrict to one namespace. */
    namespace?: string;
    /** Restrict to one status. */
    status?: TranslationStatus;
    /** Case-insensitive text matched against the key and the English source. */
    search?: string;
    /** Restrict to keys rendered on a path this route pattern matches. */
    route?: string;
    /** Page size. */
    limit?: number;
    /** Rows to skip. */
    offset?: number;
}

/** Fields for saving one translation. */
export interface ITranslationInput {
    /** Owner of the key. */
    namespace: string;
    /** Key within the namespace. */
    key: string;
    /** Target language. */
    language: string;
    /** Translated text. */
    text: string;
}

/** Fields for saving several translations into one language at once. */
export interface ITranslationBatchInput {
    /** Target language shared by every entry. */
    language: string;
    /** The keys to save and the text for each. */
    translations: Array<{ namespace: string; key: string; text: string }>;
}

/** Fields for adding a key by hand. */
export interface IKeyInput {
    /** Owner of the key. */
    namespace: string;
    /** Key within the namespace. */
    key: string;
    /** English source text. */
    source: string;
}

/** Collaborators the admin service needs. */
export interface ILocalizationAdminServiceDependencies {
    /** Core database service. */
    database: IDatabaseService;
    /** Module-scoped logger; every change is recorded with the actor. */
    logger: ISystemLogService;
    /**
     * Lists the paths the site already serves, such as CMS page slugs and menu
     * URLs. Consulted before a language is enabled, because an enabled code
     * claims every path that starts with `/<code>/`.
     */
    listKnownPaths: () => Promise<string[]>;
    /** Called after every change visitors could see, to clear the read-side snapshot. */
    onChange: () => void;
}

/**
 * Administrative operations over the four localization collections.
 */
export class LocalizationAdminService {
    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;
    private readonly listKnownPaths: () => Promise<string[]>;
    private readonly onChange: () => void;

    /**
     * @param deps - Collaborators wired by the module.
     */
    constructor(deps: ILocalizationAdminServiceDependencies) {
        this.database = deps.database;
        this.logger = deps.logger;
        this.listKnownPaths = deps.listKnownPaths;
        this.onChange = deps.onChange;
    }

    // ─── Languages ──────────────────────────────────────────────────────────

    /**
     * List every configured language with how far its translation has got.
     *
     * @returns Languages ordered by code, each with translated, stale, and missing counts.
     */
    async listLanguages(): Promise<ILanguageSummary[]> {
        const languages = await this.languages().find({}).sort({ code: 1 }).toArray();
        const keyIndex = await this.loadKeySourceDates();
        const summaries: ILanguageSummary[] = [];

        for (const language of languages) {
            const translations = await this.translations()
                .find({ language: language.code }, { projection: { _id: 0, namespace: 1, key: 1, updatedAt: 1 } })
                .toArray();
            let translated = 0;
            let stale = 0;
            for (const translation of translations) {
                const sourceChangedAt = keyIndex.get(joinKeyId(translation.namespace, translation.key));
                if (sourceChangedAt) {
                    if (translation.updatedAt >= sourceChangedAt) {
                        translated += 1;
                    } else {
                        stale += 1;
                    }
                }
            }
            summaries.push({
                ...this.toLanguage(language),
                translated,
                stale,
                missing: keyIndex.size - translated - stale
            });
        }

        return summaries;
    }

    /**
     * Add a language. It starts disabled, so adding one never changes what
     * visitors see.
     *
     * @param input - Code, names, and direction.
     * @param actor - Who made the change, for the log.
     * @returns The stored language.
     * @throws LocalizationValidationError for a bad code or name, LocalizationConflictError for a duplicate.
     */
    async createLanguage(input: ILanguageInput, actor: string): Promise<ILanguage> {
        const code = typeof input.code === 'string' ? input.code.trim() : '';
        if (!LANGUAGE_CODE_PATTERN.test(code)) {
            throw new LocalizationValidationError('Invalid language code: use a BCP 47 code such as "zh" or "pt-BR"');
        }
        if (code === DEFAULT_LANGUAGE) {
            throw new LocalizationValidationError(`"${DEFAULT_LANGUAGE}" is the default language and is always available`);
        }
        // `api` and `mcp` are infrastructure addresses rather than available
        // prefixes. The frontend middleware matcher skips every path beginning
        // `api`, and `next.config.mjs` rewrites `/api/...` and the exact path
        // `/mcp` to the backend, so a language on one of these codes would
        // publish URLs that never reach the `[lang]` tree. They are the only
        // reserved first segments this code pattern can produce; `uploads`,
        // `images`, and `plugins` are too long for it to match.
        if (code === 'api' || code.startsWith('api-') || code === 'mcp') {
            throw new LocalizationValidationError(`"${code}" is reserved for platform routing and cannot be a language code`);
        }
        const now = new Date();
        const document: ILanguageDocument = {
            code,
            name: this.requireName(input.name, 'name'),
            nativeName: this.requireName(input.nativeName, 'native name'),
            direction: this.requireDirection(input.direction ?? 'ltr'),
            enabled: false,
            createdAt: now,
            updatedAt: now
        };

        try {
            await this.languages().insertOne(document);
        } catch (error) {
            throw this.translateDuplicate(error, `Language "${code}" already exists`);
        }

        this.logger.info({ code, actor }, 'Language added');
        return this.toLanguage(document);
    }

    /**
     * Change a language's names, direction, or enabled state.
     *
     * Enabling is refused when existing pages already start with `/<code>/`,
     * because once enabled the code would claim those addresses for the new
     * language and the existing pages would disappear behind it.
     *
     * @param code - Language to change.
     * @param patch - Fields to change.
     * @param actor - Who made the change, for the log.
     * @returns The updated language.
     */
    async updateLanguage(code: string, patch: ILanguagePatch, actor: string): Promise<ILanguage> {
        const existing = await this.languages().findOne({ code });
        if (!existing) {
            throw new LocalizationNotFoundError(`Language "${code}" not found`);
        }

        const set: Partial<ILanguageDocument> = { updatedAt: new Date() };
        if (patch.name !== undefined) {
            set.name = this.requireName(patch.name, 'name');
        }
        if (patch.nativeName !== undefined) {
            set.nativeName = this.requireName(patch.nativeName, 'native name');
        }
        if (patch.direction !== undefined) {
            set.direction = this.requireDirection(patch.direction);
        }
        if (patch.enabled !== undefined) {
            if (typeof patch.enabled !== 'boolean') {
                throw new LocalizationValidationError('Invalid enabled flag: expected true or false');
            }
            if (patch.enabled && !existing.enabled) {
                await this.assertCodeIsFree(code);
            }
            set.enabled = patch.enabled;
        }

        await this.languages().updateOne({ code }, { $set: set });
        this.onChange();
        this.logger.info({ code, actor, changes: Object.keys(set).filter(field => field !== 'updatedAt') }, 'Language updated');

        return this.toLanguage({ ...existing, ...set });
    }

    /**
     * Remove a language, its translations, and its place on every route.
     * Routes left with no language are removed too, since they no longer
     * publish anything.
     *
     * @param code - Language to remove.
     * @param actor - Who made the change, for the log.
     */
    async deleteLanguage(code: string, actor: string): Promise<void> {
        const result = await this.languages().deleteOne({ code });
        if (result.deletedCount === 0) {
            throw new LocalizationNotFoundError(`Language "${code}" not found`);
        }
        const translations = await this.translations().deleteMany({ language: code });
        await this.routes().updateMany({ languages: code }, { $pull: { languages: code } });
        const emptied = await this.routes().deleteMany({ languages: { $size: 0 } });

        this.onChange();
        this.logger.info(
            { code, actor, translationsDeleted: translations.deletedCount, routesDeleted: emptied.deletedCount },
            'Language deleted'
        );
    }

    // ─── Routes ─────────────────────────────────────────────────────────────

    /**
     * List published routes with the translation gaps on each.
     *
     * The gap counts come from the paths the frontend reported each key on,
     * so they cover the keys a page has actually rendered, not every key in
     * the namespace.
     *
     * @returns Routes ordered by pattern.
     */
    async listRoutes(): Promise<ILocalizedRouteSummary[]> {
        const routes = await this.routes().find({}).sort({ pattern: 1 }).toArray();
        const languageCodes = (await this.languages().find({}, { projection: { code: 1 } }).toArray())
            .map(language => language.code);
        const keys = await this.keys()
            .find({}, { projection: { _id: 0, namespace: 1, key: 1, routes: 1 } })
            .toArray();
        const translated = await this.loadTranslatedSets();

        return routes.map(route => {
            const routeKeys = keys.filter(key => key.routes.some(path => matchRoutePattern(route.pattern, path)));
            const missingByLanguage: Record<string, number> = {};
            for (const code of languageCodes) {
                const done = translated.get(code) ?? new Set<string>();
                missingByLanguage[code] = routeKeys.filter(key => !done.has(joinKeyId(key.namespace, key.key))).length;
            }
            return { ...this.toRoute(route), keyCount: routeKeys.length, missingByLanguage };
        });
    }

    /**
     * Publish a route pattern in a set of languages.
     *
     * @param input - Pattern and languages.
     * @param actor - Who made the change, for the log.
     * @returns The stored route.
     */
    async createRoute(input: IRouteInput, actor: string): Promise<ILocalizedRoute> {
        const document: ILocalizedRouteDocument = {
            _id: new ObjectId(),
            pattern: this.requirePattern(input.pattern),
            languages: await this.requireLanguages(input.languages),
            updatedAt: new Date()
        };

        try {
            await this.routes().insertOne(document);
        } catch (error) {
            throw this.translateDuplicate(error, `Route "${document.pattern}" already exists`);
        }

        this.onChange();
        this.logger.info({ pattern: document.pattern, languages: document.languages, actor }, 'Localized route added');
        return this.toRoute(document);
    }

    /**
     * Change a route's pattern or its languages.
     *
     * @param id - Route identifier.
     * @param patch - New pattern, new language list, or both.
     * @param actor - Who made the change, for the log.
     * @returns The updated route.
     */
    async updateRoute(id: string, patch: Partial<IRouteInput>, actor: string): Promise<ILocalizedRoute> {
        const _id = this.requireObjectId(id);
        const existing = await this.routes().findOne({ _id });
        if (!existing) {
            throw new LocalizationNotFoundError('Route not found');
        }

        const set: Partial<ILocalizedRouteDocument> = { updatedAt: new Date() };
        if (patch.pattern !== undefined) {
            set.pattern = this.requirePattern(patch.pattern);
        }
        if (patch.languages !== undefined) {
            set.languages = await this.requireLanguages(patch.languages);
        }

        try {
            await this.routes().updateOne({ _id }, { $set: set });
        } catch (error) {
            throw this.translateDuplicate(error, `Route "${set.pattern}" already exists`);
        }

        this.onChange();
        const updated = { ...existing, ...set };
        this.logger.info({ pattern: updated.pattern, languages: updated.languages, actor }, 'Localized route updated');
        return this.toRoute(updated);
    }

    /**
     * Stop publishing a route in any language.
     *
     * @param id - Route identifier.
     * @param actor - Who made the change, for the log.
     */
    async deleteRoute(id: string, actor: string): Promise<void> {
        const _id = this.requireObjectId(id);
        const existing = await this.routes().findOneAndDelete({ _id });
        if (!existing) {
            throw new LocalizationNotFoundError('Route not found');
        }
        this.onChange();
        this.logger.info({ pattern: existing.pattern, actor }, 'Localized route deleted');
    }

    // ─── Keys and translations ──────────────────────────────────────────────

    /**
     * List the namespaces that hold keys, for the namespace filter.
     *
     * @returns Namespaces with key counts, ordered by name.
     */
    async listNamespaces(): Promise<ITranslationNamespaceSummary[]> {
        const groups = await this.keys()
            .aggregate<{ _id: string; keys: number }>([
                { $group: { _id: '$namespace', keys: { $sum: 1 } } },
                { $sort: { _id: 1 } }
            ])
            .toArray();
        return groups.map(group => ({ namespace: group._id, keys: group.keys }));
    }

    /**
     * List keys with their translation in one language, filtered and paged.
     *
     * The status and route filters depend on joining two collections and on
     * pattern matching, so they run in memory over the keys the database
     * filter returns. The key count is bounded by the observation cap, which
     * keeps that join small.
     *
     * @param query - Language, filters, and page.
     * @returns One page of rows and the total matching the filter.
     */
    async listTranslations(query: ITranslationListQuery): Promise<ITranslationPage> {
        const language = await this.requireExistingLanguage(query.language);
        const filter: Record<string, unknown> = {};
        if (query.namespace) {
            filter.namespace = query.namespace;
        }
        if (query.search && query.search.trim() !== '') {
            const pattern = new RegExp(escapeRegExp(query.search.trim()), 'i');
            filter.$or = [{ key: pattern }, { source: pattern }];
        }

        const keys = await this.keys().find(filter).sort({ namespace: 1, key: 1 }).toArray();
        const translations = await this.translations().find({ language }).toArray();
        const byKey = new Map(translations.map(translation => [joinKeyId(translation.namespace, translation.key), translation]));

        const rows = keys
            .filter(key => !query.route || key.routes.some(path => matchRoutePattern(query.route as string, path)))
            .map(key => this.toRow(key, language, byKey.get(joinKeyId(key.namespace, key.key)) ?? null))
            .filter(row => !query.status || row.status === query.status);

        const limit = clampInteger(query.limit, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE);
        const offset = clampInteger(query.offset, 0, Number.MAX_SAFE_INTEGER, 0);
        return { rows: rows.slice(offset, offset + limit), total: rows.length };
    }

    /**
     * Save the translation of one key into one language.
     *
     * @param input - Key, language, and text.
     * @param actor - Who made the change, recorded on the translation and in the log.
     * @returns The stored translation.
     */
    async saveTranslation(input: ITranslationInput, actor: string): Promise<ITranslation> {
        const language = await this.requireExistingLanguage(input.language);
        const document = await this.buildTranslationDocument(input, language, actor);
        await this.writeTranslation(document);

        this.onChange();
        this.logger.info({ namespace: document.namespace, key: document.key, language, actor }, 'Translation saved');
        return this.toTranslation(document);
    }

    /**
     * Save several translations into one language in a single request.
     *
     * The Translations tab can hold a page of unsaved editors at once, often
     * filled by one AI suggestion run. Saving them one request at a time would
     * spend a slot of the admin rate limit per row and run out partway through
     * a page. Every entry is validated before anything is written, so a bad
     * entry rejects the whole batch instead of leaving half of it saved.
     *
     * @param input - The shared language and the entries to save.
     * @param actor - Who made the change, recorded on each translation and in the log.
     * @returns The stored translations, in the order they were given.
     */
    async saveTranslations(input: ITranslationBatchInput, actor: string): Promise<ITranslation[]> {
        const language = await this.requireExistingLanguage(input.language);
        const entries = Array.isArray(input.translations) ? input.translations : [];
        if (entries.length === 0 || entries.length > MAX_BATCH_SAVE) {
            throw new LocalizationValidationError(`Invalid batch: send 1–${MAX_BATCH_SAVE} translations`);
        }

        const documents: ITranslationDocument[] = [];
        for (const entry of entries) {
            documents.push(await this.buildTranslationDocument({ ...entry, language }, language, actor));
        }
        for (const document of documents) {
            await this.writeTranslation(document);
        }

        this.onChange();
        this.logger.info({ language, count: documents.length, keys: documents.map(document => joinKeyId(document.namespace, document.key)), actor }, 'Translations saved');
        return documents.map(document => this.toTranslation(document));
    }

    /**
     * Check one translation against its key and the text rules, and build the
     * document to store. Shared by the single and batch saves so both apply
     * exactly the same rules.
     *
     * @param input - Key and text supplied by the caller.
     * @param language - The language code, already confirmed to exist.
     * @param actor - Who made the change, recorded on the document.
     * @returns The document ready to upsert.
     */
    private async buildTranslationDocument(input: ITranslationInput, language: string, actor: string): Promise<ITranslationDocument> {
        // Both values go straight into a query filter, so reject anything that
        // is not a plain string first. A JSON body can carry an object such as
        // `{ "$ne": "" }`, which Mongo would read as an operator and match a
        // key the caller never named.
        const namespace = typeof input.namespace === 'string' ? input.namespace.trim() : '';
        const keyName = typeof input.key === 'string' ? input.key.trim() : '';
        const key = await this.keys().findOne({ namespace, key: keyName });
        if (!key) {
            throw new LocalizationNotFoundError(`Key "${namespace}:${keyName}" not found`);
        }
        const text = typeof input.text === 'string' ? input.text : '';
        if (text.trim() === '' || text.length > MAX_TRANSLATION_LENGTH) {
            throw new LocalizationValidationError(`Invalid translation for "${namespace}:${keyName}": text must be 1–${MAX_TRANSLATION_LENGTH} characters`);
        }

        return {
            namespace: key.namespace,
            key: key.key,
            language,
            text,
            updatedAt: new Date(),
            updatedBy: actor
        };
    }

    /**
     * Store one translation, replacing any earlier text for the same key and
     * language.
     *
     * @param document - The validated document from `buildTranslationDocument`.
     */
    private async writeTranslation(document: ITranslationDocument): Promise<void> {
        await this.translations().updateOne(
            { namespace: document.namespace, key: document.key, language: document.language },
            { $set: document },
            { upsert: true }
        );
    }

    /**
     * Remove one translation, so visitors see the English text for that key.
     *
     * @param namespace - Owner of the key.
     * @param key - Key within the namespace.
     * @param language - Language to remove.
     * @param actor - Who made the change, for the log.
     */
    async deleteTranslation(namespace: string, key: string, language: string, actor: string): Promise<void> {
        const result = await this.translations().deleteOne({ namespace, key, language });
        if (result.deletedCount === 0) {
            throw new LocalizationNotFoundError('Translation not found');
        }
        this.onChange();
        this.logger.info({ namespace, key, language, actor }, 'Translation deleted');
    }

    /**
     * Add a key by hand, for text a translator wants to prepare before any
     * page has rendered it.
     *
     * @param input - Namespace, key, and English source.
     * @param actor - Who made the change, for the log.
     * @returns The stored key.
     */
    async createKey(input: IKeyInput, actor: string): Promise<ITranslationKey> {
        const namespace = typeof input.namespace === 'string' ? input.namespace.trim() : '';
        if (namespace !== CORE_NAMESPACE && !PLUGIN_ID_PATTERN.test(namespace)) {
            throw new LocalizationValidationError(`Invalid namespace: use "${CORE_NAMESPACE}" or a plugin id`);
        }
        const key = typeof input.key === 'string' ? input.key.trim() : '';
        if (!KEY_PATTERN.test(key)) {
            throw new LocalizationValidationError('Invalid key: use letters, digits, dots, colons, dashes, or underscores');
        }
        const source = typeof input.source === 'string' ? input.source : '';
        if (source.trim() === '' || source.length > MAX_SOURCE_LENGTH) {
            throw new LocalizationValidationError(`Invalid source: English text must be 1–${MAX_SOURCE_LENGTH} characters`);
        }

        const now = new Date();
        const document: ITranslationKeyDocument = {
            namespace,
            key,
            source,
            routes: [],
            origin: 'manual',
            firstSeenAt: now,
            lastSeenAt: now,
            sourceChangedAt: now
        };
        try {
            await this.keys().insertOne(document);
        } catch (error) {
            throw this.translateDuplicate(error, `Key "${namespace}:${key}" already exists`);
        }

        this.logger.info({ namespace, key, actor }, 'Translation key added');
        return this.toKey(document);
    }

    /**
     * Remove a key and every translation of it. Used for text the code no
     * longer renders, so the listing stops asking for it to be translated.
     *
     * @param namespace - Owner of the key.
     * @param key - Key within the namespace.
     * @param actor - Who made the change, for the log.
     */
    async deleteKey(namespace: string, key: string, actor: string): Promise<void> {
        const result = await this.keys().deleteOne({ namespace, key });
        if (result.deletedCount === 0) {
            throw new LocalizationNotFoundError(`Key "${namespace}:${key}" not found`);
        }
        const translations = await this.translations().deleteMany({ namespace, key });
        this.onChange();
        this.logger.info({ namespace, key, actor, translationsDeleted: translations.deletedCount }, 'Translation key deleted');
    }

    // ─── Helpers ────────────────────────────────────────────────────────────

    /**
     * Refuse to enable a code that existing pages already use as their first
     * path segment.
     *
     * @param code - Language code about to be enabled.
     * @throws LocalizationConflictError naming the first few clashing paths.
     */
    private async assertCodeIsFree(code: string): Promise<void> {
        const prefix = `/${code}`;
        const paths = await this.listKnownPaths();
        const conflicts = [...new Set(paths)].filter(path => path === prefix || path.startsWith(`${prefix}/`));
        if (conflicts.length > 0) {
            const named = conflicts.slice(0, MAX_CONFLICTS_REPORTED).join(', ');
            const more = conflicts.length > MAX_CONFLICTS_REPORTED ? ` and ${conflicts.length - MAX_CONFLICTS_REPORTED} more` : '';
            throw new LocalizationConflictError(
                `Cannot enable "${code}": existing pages already use ${prefix} as their address (${named}${more}). Move those pages first.`
            );
        }
    }

    /**
     * Map every key to the moment its English source last changed, which is
     * what decides whether a translation is current or stale.
     *
     * @returns Source-change dates keyed by `joinKeyId`.
     */
    private async loadKeySourceDates(): Promise<Map<string, Date>> {
        const keys = await this.keys()
            .find({}, { projection: { _id: 0, namespace: 1, key: 1, sourceChangedAt: 1 } })
            .toArray();
        return new Map(keys.map(key => [joinKeyId(key.namespace, key.key), key.sourceChangedAt]));
    }

    /**
     * Group the translated keys by language.
     *
     * @returns For each language code, the set of `joinKeyId` values that have a translation.
     */
    private async loadTranslatedSets(): Promise<Map<string, Set<string>>> {
        const translations = await this.translations()
            .find({}, { projection: { _id: 0, namespace: 1, key: 1, language: 1 } })
            .toArray();
        const sets = new Map<string, Set<string>>();
        for (const translation of translations) {
            const set = sets.get(translation.language) ?? new Set<string>();
            set.add(joinKeyId(translation.namespace, translation.key));
            sets.set(translation.language, set);
        }
        return sets;
    }

    /**
     * Confirm a language is configured and return its code.
     *
     * @param code - Candidate code from the request.
     * @returns The same code.
     */
    private async requireExistingLanguage(code: unknown): Promise<string> {
        if (typeof code !== 'string' || code === '') {
            throw new LocalizationValidationError('Invalid language: a language code is required');
        }
        const language = await this.languages().findOne({ code }, { projection: { code: 1 } });
        if (!language) {
            throw new LocalizationNotFoundError(`Language "${code}" not found`);
        }
        return code;
    }

    /**
     * Validate a route's language list against the configured languages.
     *
     * @param languages - Candidate codes from the request.
     * @returns The de-duplicated codes.
     */
    private async requireLanguages(languages: unknown): Promise<string[]> {
        if (!Array.isArray(languages) || languages.some(code => typeof code !== 'string')) {
            throw new LocalizationValidationError('Invalid languages: expected an array of language codes');
        }
        const unique = [...new Set(languages as string[])];
        const known = await this.languages().find({ code: { $in: unique } }, { projection: { code: 1 } }).toArray();
        const knownCodes = new Set(known.map(language => language.code));
        const unknown = unique.filter(code => !knownCodes.has(code));
        if (unknown.length > 0) {
            throw new LocalizationValidationError(`Invalid languages: ${unknown.join(', ')} not configured`);
        }
        return unique;
    }

    /**
     * Validate a route pattern.
     *
     * @param pattern - Candidate pattern from the request.
     * @returns The pattern without a trailing slash.
     */
    private requirePattern(pattern: unknown): string {
        const trimmed = typeof pattern === 'string' ? pattern.trim() : '';
        const normalized = trimmed.length > 1 ? trimmed.replace(/\/$/, '') : trimmed;
        if (!isValidRoutePattern(normalized)) {
            throw new LocalizationValidationError(
                'Invalid route pattern: start with "/", use ":name" for one segment and a final "*" for the rest'
            );
        }
        return normalized;
    }

    /**
     * Validate a language name.
     *
     * @param value - Candidate name.
     * @param label - Field name used in the error message.
     * @returns The trimmed name.
     */
    private requireName(value: unknown, label: string): string {
        const trimmed = typeof value === 'string' ? value.trim() : '';
        if (trimmed === '' || trimmed.length > MAX_NAME_LENGTH) {
            throw new LocalizationValidationError(`Invalid ${label}: must be 1–${MAX_NAME_LENGTH} characters`);
        }
        return trimmed;
    }

    /**
     * Validate a script direction.
     *
     * @param value - Candidate direction.
     * @returns The direction.
     */
    private requireDirection(value: unknown): LanguageDirection {
        if (value !== 'ltr' && value !== 'rtl') {
            throw new LocalizationValidationError('Invalid direction: expected "ltr" or "rtl"');
        }
        return value;
    }

    /**
     * Parse a route id.
     *
     * @param id - Candidate id from the URL.
     * @returns The ObjectId.
     */
    private requireObjectId(id: string): ObjectId {
        if (!ObjectId.isValid(id)) {
            throw new LocalizationNotFoundError('Route not found');
        }
        return new ObjectId(id);
    }

    /**
     * Turn a duplicate-key error from Mongo into a conflict error, and pass
     * any other error through unchanged.
     *
     * @param error - The thrown error.
     * @param message - Conflict message for the duplicate case.
     * @returns The error to throw.
     */
    private translateDuplicate(error: unknown, message: string): unknown {
        const isDuplicate = typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
        return isDuplicate ? new LocalizationConflictError(message) : error;
    }

    /**
     * Convert a stored language to its wire form.
     *
     * @param document - Stored language.
     * @returns The API shape.
     */
    private toLanguage(document: ILanguageDocument): ILanguage {
        return {
            code: document.code,
            name: document.name,
            nativeName: document.nativeName,
            direction: document.direction,
            enabled: document.enabled,
            createdAt: document.createdAt.toISOString(),
            updatedAt: document.updatedAt.toISOString()
        };
    }

    /**
     * Convert a stored route to its wire form.
     *
     * @param document - Stored route.
     * @returns The API shape.
     */
    private toRoute(document: ILocalizedRouteDocument): ILocalizedRoute {
        return {
            id: document._id.toHexString(),
            pattern: document.pattern,
            languages: document.languages,
            updatedAt: document.updatedAt.toISOString()
        };
    }

    /**
     * Convert a stored key to its wire form.
     *
     * @param document - Stored key.
     * @returns The API shape.
     */
    private toKey(document: ITranslationKeyDocument): ITranslationKey {
        return {
            namespace: document.namespace,
            key: document.key,
            source: document.source,
            routes: document.routes,
            origin: document.origin,
            firstSeenAt: document.firstSeenAt.toISOString(),
            lastSeenAt: document.lastSeenAt.toISOString(),
            sourceChangedAt: document.sourceChangedAt.toISOString()
        };
    }

    /**
     * Convert a stored translation to its wire form.
     *
     * @param document - Stored translation.
     * @returns The API shape.
     */
    private toTranslation(document: ITranslationDocument): ITranslation {
        return {
            namespace: document.namespace,
            key: document.key,
            language: document.language,
            text: document.text,
            updatedAt: document.updatedAt.toISOString(),
            updatedBy: document.updatedBy
        };
    }

    /**
     * Combine a key and its translation into a listing row with a status.
     *
     * @param key - Stored key.
     * @param language - Language the row describes.
     * @param translation - Stored translation, or null.
     * @returns The row.
     */
    private toRow(key: ITranslationKeyDocument, language: string, translation: ITranslationDocument | null): ITranslationRow {
        let status: TranslationStatus = 'missing';
        if (translation) {
            status = translation.updatedAt >= key.sourceChangedAt ? 'translated' : 'stale';
        }
        return {
            ...this.toKey(key),
            language,
            translation: translation
                ? { text: translation.text, updatedAt: translation.updatedAt.toISOString(), updatedBy: translation.updatedBy }
                : null,
            status
        };
    }

    /** @returns The languages collection. */
    private languages() {
        return this.database.getCollection<ILanguageDocument>(LANGUAGES_COLLECTION);
    }

    /** @returns The routes collection. */
    private routes() {
        return this.database.getCollection<ILocalizedRouteDocument>(ROUTES_COLLECTION);
    }

    /** @returns The keys collection. */
    private keys() {
        return this.database.getCollection<ITranslationKeyDocument>(KEYS_COLLECTION);
    }

    /** @returns The translations collection. */
    private translations() {
        return this.database.getCollection<ITranslationDocument>(TRANSLATIONS_COLLECTION);
    }
}

/**
 * Escape a user-typed search string for use inside a regular expression, so
 * characters such as `.` and `(` match themselves.
 *
 * @param value - Raw search text.
 * @returns The escaped text.
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Read an optional integer from a query and keep it inside a range.
 *
 * @param value - Candidate value, possibly undefined or not a number.
 * @param min - Smallest allowed value.
 * @param max - Largest allowed value.
 * @param fallback - Value used when the candidate is missing or invalid.
 * @returns An integer between `min` and `max`.
 */
function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
    const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.min(max, Math.max(min, parsed));
}
