/**
 * @fileoverview The read side of localization, published as `'localization'`.
 *
 * Every page render needs two things from this module: which languages are
 * live on which routes, and the translations for the language being rendered.
 * Both are read far more often than they change, so this service keeps them in
 * memory and rebuilds them only after an administrator saves a change, which
 * the admin service signals by calling `invalidate()`. That is what lets a
 * translated page be served without a database round trip per string.
 */

import type {
    IDatabaseService,
    ILanguage,
    ILocalizationPublicConfig,
    ILocalizationService,
    IPublicLocalizedRoute,
    ISystemLogService,
    ITranslationCatalog,
    TranslationParams
} from '@/types';
import { DEFAULT_LANGUAGE, findPublishedLanguages, interpolateTranslation } from '@/types';
import type { ILanguageDocument, ILocalizedRouteDocument, ITranslationDocument } from '../database/index.js';
import { LANGUAGES_COLLECTION, ROUTES_COLLECTION, TRANSLATIONS_COLLECTION } from '../database/index.js';
import { toLanguage } from './toLanguage.js';

/**
 * Longest a snapshot that includes content routes is served before it is
 * rebuilt, even without an `invalidate()` call. Content routes come from
 * another module, whose approvals can finish after it has already asked for a
 * rebuild, so this bounds how long a snapshot read in that gap can stay wrong.
 * It matches the 60 seconds the frontend caches the snapshot for anyway.
 */
const CONTENT_ROUTES_MAX_AGE_MS = 60_000;

/**
 * Combine routes that share a pattern into one entry listing all their
 * languages, ordered by pattern.
 *
 * An administrator's route and a content route can name the same address, for
 * example when a route was published for a CMS page by hand before the page
 * had translations of its own. One entry per pattern keeps the snapshot free of
 * duplicates for consumers that key on the pattern, such as the switcher click
 * counters.
 *
 * @param routes - Routes from every source, possibly repeating a pattern.
 * @returns One route per pattern, with the languages de-duplicated.
 */
function mergeRoutes(routes: ReadonlyArray<IPublicLocalizedRoute>): IPublicLocalizedRoute[] {
    const merged = new Map<string, Set<string>>();
    for (const route of routes) {
        const languages = merged.get(route.pattern) ?? new Set<string>();
        route.languages.forEach(language => languages.add(language));
        merged.set(route.pattern, languages);
    }
    return [...merged.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([pattern, languages]) => ({ pattern, languages: [...languages] }));
}

/** Dependencies injected once at bootstrap. */
export interface ILocalizationServiceDependencies {
    /** Core database service; collection names carry the module prefix. */
    database: IDatabaseService;
    /** Module-scoped logger. */
    logger: ISystemLogService;
    /**
     * Lists addresses another module publishes in other languages on its own,
     * such as CMS pages that have a published translation. They are added to
     * the snapshot's routes, so the middleware, `hreflang` links, sitemap, and
     * language switcher treat them like routes an administrator published.
     * Optional; without it only the administrator's routes are served.
     */
    listContentRoutes?: () => Promise<IPublicLocalizedRoute[]>;
}

/**
 * Singleton implementation of `ILocalizationService`.
 *
 * Follows the `setDependencies()` / `getInstance()` pattern because the
 * in-memory snapshot is shared state: every caller must see the same snapshot
 * and the same invalidation, or one request could route `/zh/...` while the
 * next does not.
 */
export class LocalizationService implements ILocalizationService {
    private static instance: LocalizationService | null = null;

    private readonly database: IDatabaseService;
    private readonly logger: ISystemLogService;
    private readonly listContentRoutes: (() => Promise<IPublicLocalizedRoute[]>) | null;

    /**
     * The public snapshot being served, or the load in progress. Holding the
     * promise rather than the value means concurrent requests after an
     * invalidation share one database read instead of each starting their own.
     */
    private publicConfig: Promise<ILocalizationPublicConfig> | null = null;

    /** When the current snapshot load started, for `CONTENT_ROUTES_MAX_AGE_MS`. */
    private publicConfigStartedAt = 0;

    /** Catalogs by language code, with the same sharing rule as `publicConfig`. */
    private readonly catalogs = new Map<string, Promise<ITranslationCatalog>>();

    /**
     * Private so construction only happens through `setDependencies`.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    private constructor(deps: ILocalizationServiceDependencies) {
        this.database = deps.database;
        this.logger = deps.logger;
        this.listContentRoutes = deps.listContentRoutes ?? null;
    }

    /**
     * Wire the singleton. The first call constructs it; later calls are no-ops
     * so bootstrap and tests cannot configure two instances.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    public static setDependencies(deps: ILocalizationServiceDependencies): void {
        if (!LocalizationService.instance) {
            LocalizationService.instance = new LocalizationService(deps);
        }
    }

    /**
     * Return the configured singleton.
     *
     * @returns The shared service.
     * @throws When `setDependencies` has not run, which is a bootstrap ordering bug.
     */
    public static getInstance(): LocalizationService {
        if (!LocalizationService.instance) {
            throw new Error('LocalizationService.setDependencies() must be called before getInstance()');
        }
        return LocalizationService.instance;
    }

    /**
     * Drop the singleton so each test can wire fresh mocks.
     */
    public static resetForTests(): void {
        LocalizationService.instance = null;
    }

    /**
     * Discard the in-memory snapshot and catalogs so the next read reloads
     * them. The admin service calls this after every saved change, which is
     * what makes an edit visible on the next page render.
     */
    public invalidate(): void {
        this.publicConfig = null;
        this.catalogs.clear();
    }

    /** @inheritdoc */
    public async getPublicConfig(): Promise<ILocalizationPublicConfig> {
        const expired = this.listContentRoutes !== null
            && Date.now() - this.publicConfigStartedAt > CONTENT_ROUTES_MAX_AGE_MS;
        if (!this.publicConfig || expired) {
            const load = this.loadPublicConfig();
            this.publicConfig = load;
            this.publicConfigStartedAt = Date.now();
            // A failed load must not stay cached, or one database hiccup would
            // pin the site to that error until the next admin edit.
            load.catch(() => {
                if (this.publicConfig === load) {
                    this.publicConfig = null;
                }
            });
        }
        return this.publicConfig;
    }

    /** @inheritdoc */
    public async getCatalog(language: string): Promise<ITranslationCatalog> {
        let catalog = this.catalogs.get(language);
        if (!catalog) {
            const load = this.loadCatalog(language);
            this.catalogs.set(language, load);
            load.catch(() => {
                if (this.catalogs.get(language) === load) {
                    this.catalogs.delete(language);
                }
            });
            catalog = load;
        }
        return catalog;
    }

    /** @inheritdoc */
    public async translate(
        namespace: string,
        key: string,
        language: string,
        fallback: string,
        params?: TranslationParams
    ): Promise<string> {
        const catalog = await this.getCatalog(language);
        const text = catalog.entries[namespace]?.[key] ?? fallback;
        return interpolateTranslation(text, params);
    }

    /** @inheritdoc */
    public async getLanguage(code: string): Promise<ILanguage | null> {
        // A string check before the query keeps an object such as
        // `{ $ne: null }` from being read as a Mongo operator.
        const document = typeof code === 'string' && code !== ''
            ? await this.database.getCollection<ILanguageDocument>(LANGUAGES_COLLECTION).findOne({ code })
            : null;
        return document ? toLanguage(document) : null;
    }

    /** @inheritdoc */
    public async getLanguagesForPath(path: string): Promise<string[]> {
        const config = await this.getPublicConfig();
        return findPublishedLanguages(config, path);
    }

    /**
     * Build the public snapshot from storage.
     *
     * Only enabled languages appear, and each route lists only its enabled
     * languages, so a consumer can trust the snapshot without cross-checking.
     * A route left with no enabled language is omitted entirely. The routes
     * are the administrator's published routes plus the content routes, such
     * as translated CMS pages, merged by pattern.
     *
     * @returns The snapshot the public config endpoint serves.
     */
    private async loadPublicConfig(): Promise<ILocalizationPublicConfig> {
        const languages = await this.database
            .getCollection<ILanguageDocument>(LANGUAGES_COLLECTION)
            .find({ enabled: true })
            .sort({ code: 1 })
            .toArray();
        const enabledCodes = new Set(languages.map(language => language.code));

        const [routes, contentRoutes] = await Promise.all([
            this.database
                .getCollection<ILocalizedRouteDocument>(ROUTES_COLLECTION)
                .find({})
                .sort({ pattern: 1 })
                .toArray(),
            this.loadContentRoutes()
        ]);

        const config: ILocalizationPublicConfig = {
            defaultLanguage: DEFAULT_LANGUAGE,
            languages: languages.map(language => ({
                code: language.code,
                name: language.name,
                nativeName: language.nativeName,
                direction: language.direction
            })),
            routes: mergeRoutes([...routes, ...contentRoutes])
                .map(route => ({
                    pattern: route.pattern,
                    languages: route.languages.filter(code => enabledCodes.has(code))
                }))
                .filter(route => route.languages.length > 0)
        };

        this.logger.debug(
            { languages: config.languages.length, routes: config.routes.length },
            'Localization snapshot loaded'
        );
        return config;
    }

    /**
     * Ask the content route source, when one is configured, for the addresses
     * it publishes in other languages.
     *
     * A failure is logged and treated as no content routes rather than thrown.
     * Every page render reads this snapshot, so an error in another module's
     * storage must not stop the administrator's routes from being served; the
     * translated pages fall back to English-only until the next rebuild, which
     * `CONTENT_ROUTES_MAX_AGE_MS` guarantees within a minute.
     *
     * @returns The content routes, or an empty list.
     */
    private async loadContentRoutes(): Promise<IPublicLocalizedRoute[]> {
        let routes: IPublicLocalizedRoute[] = [];
        if (this.listContentRoutes) {
            try {
                routes = await this.listContentRoutes();
            } catch (error) {
                this.logger.warn({ error }, 'Content routes unavailable; localization snapshot built without them');
            }
        }
        return routes;
    }

    /**
     * Load every translation for one language into a nested lookup.
     *
     * The default language never has translations, so it short-circuits to an
     * empty catalog without touching the database.
     *
     * @param language - Language code to load.
     * @returns The catalog for that language.
     */
    private async loadCatalog(language: string): Promise<ITranslationCatalog> {
        const catalog: ITranslationCatalog = { language, entries: {} };
        if (language !== DEFAULT_LANGUAGE) {
            const translations = await this.database
                .getCollection<ITranslationDocument>(TRANSLATIONS_COLLECTION)
                .find({ language }, { projection: { _id: 0, namespace: 1, key: 1, text: 1 } })
                .toArray();
            for (const translation of translations) {
                const namespace = catalog.entries[translation.namespace] ?? {};
                namespace[translation.key] = translation.text;
                catalog.entries[translation.namespace] = namespace;
            }
        }
        return catalog;
    }
}
