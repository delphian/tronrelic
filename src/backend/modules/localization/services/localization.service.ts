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
    ILocalizationPublicConfig,
    ILocalizationService,
    ISystemLogService,
    ITranslationCatalog,
    TranslationParams
} from '@/types';
import { DEFAULT_LANGUAGE, findPublishedLanguages, interpolateTranslation } from '@/types';
import type { ILanguageDocument, ILocalizedRouteDocument, ITranslationDocument } from '../database/index.js';
import { LANGUAGES_COLLECTION, ROUTES_COLLECTION, TRANSLATIONS_COLLECTION } from '../database/index.js';

/** Dependencies injected once at bootstrap. */
export interface ILocalizationServiceDependencies {
    /** Core database service; collection names carry the module prefix. */
    database: IDatabaseService;
    /** Module-scoped logger. */
    logger: ISystemLogService;
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

    /**
     * The public snapshot being served, or the load in progress. Holding the
     * promise rather than the value means concurrent requests after an
     * invalidation share one database read instead of each starting their own.
     */
    private publicConfig: Promise<ILocalizationPublicConfig> | null = null;

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
        if (!this.publicConfig) {
            const load = this.loadPublicConfig();
            this.publicConfig = load;
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
    public async getLanguagesForPath(path: string): Promise<string[]> {
        const config = await this.getPublicConfig();
        return findPublishedLanguages(config, path);
    }

    /**
     * Build the public snapshot from storage.
     *
     * Only enabled languages appear, and each route lists only its enabled
     * languages, so a consumer can trust the snapshot without cross-checking.
     * A route left with no enabled language is omitted entirely.
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

        const routes = await this.database
            .getCollection<ILocalizedRouteDocument>(ROUTES_COLLECTION)
            .find({})
            .sort({ pattern: 1 })
            .toArray();

        const config: ILocalizationPublicConfig = {
            defaultLanguage: DEFAULT_LANGUAGE,
            languages: languages.map(language => ({
                code: language.code,
                name: language.name,
                nativeName: language.nativeName,
                direction: language.direction
            })),
            routes: routes
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
