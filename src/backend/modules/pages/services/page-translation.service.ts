/**
 * @fileoverview Translations of CMS pages: management for the admin editor,
 * public reads for the site, and the list of translated page addresses the
 * localization snapshot is built from.
 *
 * A page is served in a language only while it has a visible, published
 * translation into it. That is the per-page opt-in: a page nobody translated
 * stays English-only, and the localization module never lists a translated
 * address, `hreflang` link, or sitemap entry for it. The page and its
 * translations share one slug, so `/zh/about` is the Chinese translation of
 * `/about` and the localization middleware's prefix rule applies unchanged.
 *
 * Every write goes through the core content service as
 * `core:page-translation`, so a translation is reviewed, audited, and
 * soft-deleted the same way a page is.
 *
 * @module backend/modules/pages/services/page-translation.service
 */

import { createHash } from 'node:crypto';
import type {
    IContentActor,
    IContentService,
    ICacheService,
    IDatabaseService,
    IPage,
    IPageContent,
    IPageTranslation,
    IPageTranslationContent,
    IPageTranslationService,
    IPublicLocalizedRoute,
    IPublicPageRender,
    IPublicPageTranslationMetadata,
    ISystemLogService
} from '@/types';
import { LANGUAGE_CODE_PATTERN } from '@/types';
import { ContentError } from '../../../services/content-error.js';
import type { IPageTranslationDocument } from '../database/index.js';
import { PAGE_TRANSLATIONS_COLLECTION } from '../database/index.js';
import { MarkdownService } from './markdown.service.js';
import { PAGE_CONTENT_TYPE_ID } from './page-content-type.js';
import {
    PageTranslationContentType,
    PAGE_TRANSLATION_CONTENT_TYPE_ID
} from './page-translation-content-type.js';
import type { IPageTranslationCreateInput, IPageTranslationUpdateInput } from './page-translation-content-type.js';
import type { IPageTranslationFields } from './page-translation-prompt.js';

/**
 * What the Suggest button sends to the model, gathered by
 * `PageTranslationService.getSuggestionSource`.
 */
export interface IPageTranslationSuggestionSource {
    /** The English page's translatable fields. */
    english: IPageTranslationFields;
    /** The existing translation's fields when it is stale, otherwise null. */
    previous: IPageTranslationFields | null;
    /** The existing translation's `published` value, or false when there is none. */
    published: boolean;
    /** The existing translation's own social image, or an empty string. */
    ogImage: string;
}

/**
 * A slug that can be handed to the localization snapshot as a route pattern.
 * Page slugs are sanitized to these characters, but an `oldSlugs` entry comes
 * straight from frontmatter, and a `:` or `*` in it would turn an exact
 * address into a pattern covering other pages.
 */
const LITERAL_SLUG_PATTERN = /^\/[a-z0-9\-/]*$/;

/**
 * The page lookups the translation service needs. Declared narrowly so the
 * service depends on what it uses rather than the whole page service.
 */
export interface IPageLookup {
    /**
     * Get a page's latest edit for the admin editor.
     *
     * @param id - The page's core content id.
     * @returns The page, or null.
     */
    getPageById(id: string): Promise<IPage | null>;

    /**
     * Get the page a visitor sees at a slug.
     *
     * @param slug - The requested path.
     * @returns The visible, published page, or null.
     */
    getPublicPageBySlug(slug: string): Promise<IPage | null>;

    /**
     * List the slugs a page is stored under, for dropping render caches.
     *
     * @param pageId - The page's core content id.
     * @returns The slugs, empty when no page has that id.
     */
    listSlugsForPage(pageId: string): Promise<string[]>;
}

/** Collaborators wired once at bootstrap. */
export interface IPageTranslationServiceDependencies {
    /** Core database holding `module_pages_translations`. */
    database: IDatabaseService;
    /** Redis cache for translated renders. */
    cacheService: ICacheService;
    /** The core content service every translation operation passes through. */
    contentService: IContentService;
    /** Page lookups, supplied by the page service. */
    pages: IPageLookup;
    /**
     * Called after a change that can alter which page addresses are served in
     * which language, so the localization snapshot is rebuilt.
     */
    onRoutesChanged: () => void;
    /** Module-scoped logger. */
    logger: ISystemLogService;
}

/**
 * Singleton implementing `IPageTranslationService`.
 *
 * Singleton because it is a public API over shared state, configured once at
 * bootstrap and consumed by the admin and public routes and by the
 * localization snapshot.
 */
export class PageTranslationService implements IPageTranslationService {
    private static instance: PageTranslationService | null = null;

    private readonly contentService: IContentService;
    private readonly pages: IPageLookup;
    private readonly onRoutesChanged: () => void;
    private readonly markdown: MarkdownService;
    private readonly translations;
    private readonly contentType: PageTranslationContentType;

    /**
     * Private so construction only happens through `setDependencies`.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    private constructor(deps: IPageTranslationServiceDependencies) {
        this.contentService = deps.contentService;
        this.pages = deps.pages;
        this.onRoutesChanged = deps.onRoutesChanged;
        this.markdown = new MarkdownService(deps.cacheService);
        this.translations = deps.database.getCollection<IPageTranslationDocument>(PAGE_TRANSLATIONS_COLLECTION);
        this.contentType = new PageTranslationContentType(
            this.translations,
            this.markdown,
            (pageId) => this.pages.listSlugsForPage(pageId),
            deps.onRoutesChanged,
            deps.logger
        );
    }

    /**
     * Configure the singleton. The first call wins.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    public static setDependencies(deps: IPageTranslationServiceDependencies): void {
        if (!PageTranslationService.instance) {
            PageTranslationService.instance = new PageTranslationService(deps);
        }
    }

    /**
     * Return the configured singleton.
     *
     * @returns The translation service.
     * @throws When `setDependencies` has not run yet.
     */
    public static getInstance(): PageTranslationService {
        if (!PageTranslationService.instance) {
            throw new Error('PageTranslationService.setDependencies() must be called before getInstance()');
        }

        return PageTranslationService.instance;
    }

    /**
     * Drop the singleton so each test builds a fresh service against its own mocks.
     */
    public static resetForTests(): void {
        PageTranslationService.instance = null;
    }

    /**
     * The `core:page-translation` managed content type, for the pages module
     * to register on the core content service during `run()`.
     *
     * @returns The translation content type.
     */
    getContentType(): PageTranslationContentType {
        return this.contentType;
    }

    // ============================================================================
    // Admin management (through the core content service)
    // ============================================================================

    /** @inheritdoc */
    async listTranslations(pageId: string): Promise<IPageTranslation[]> {
        await this.requirePage(pageId);
        const docs = await this.translations.find({ pageId }).sort({ language: 1 }).toArray();
        const ids = docs.map((doc) => doc.contentId);
        const [translations, englishHash] = await Promise.all([
            ids.length > 0
                ? this.contentService.readAdmin<IPageTranslationContent>(PAGE_TRANSLATION_CONTENT_TYPE_ID, ids)
                : Promise.resolve([]),
            this.englishSourceHash(pageId)
        ]);

        return translations.map((translation) => this.toTranslation(translation, englishHash));
    }

    /** @inheritdoc */
    async createTranslation(
        pageId: string,
        language: string,
        content: string,
        actor: IContentActor
    ): Promise<IPageTranslation> {
        const page = await this.requirePage(pageId);
        if (page.deletedAt) {
            throw new ContentError('deleted', 'The page is deleted; restore it before translating it');
        }
        const sourceHash = await this.englishSourceHash(pageId);
        const input: IPageTranslationCreateInput = { pageId, language, content, sourceHash };
        const created = await this.contentService.create<IPageTranslationContent>(
            PAGE_TRANSLATION_CONTENT_TYPE_ID,
            input,
            actor
        );
        this.onRoutesChanged();

        return this.toTranslation(created, sourceHash);
    }

    /** @inheritdoc */
    async updateTranslation(
        pageId: string,
        language: string,
        content: string,
        actor: IContentActor
    ): Promise<IPageTranslation> {
        const id = await this.requireTranslationId(pageId, language);
        const sourceHash = await this.englishSourceHash(pageId);
        const patch: IPageTranslationUpdateInput = { content, sourceHash };
        const updated = await this.contentService.update<IPageTranslationContent>(
            PAGE_TRANSLATION_CONTENT_TYPE_ID,
            id,
            patch,
            actor
        );
        this.onRoutesChanged();

        return this.toTranslation(updated, sourceHash);
    }

    /** @inheritdoc */
    async deleteTranslation(pageId: string, language: string, actor: IContentActor): Promise<void> {
        const id = await this.requireTranslationId(pageId, language);
        await this.contentService.delete(PAGE_TRANSLATION_CONTENT_TYPE_ID, id, actor);
        // After core has marked its row, so a rebuild cannot still see the translation.
        this.onRoutesChanged();

        return;
    }

    /** @inheritdoc */
    async restoreTranslation(pageId: string, language: string, actor: IContentActor): Promise<IPageTranslation> {
        const id = await this.requireTranslationId(pageId, language);
        const restored = await this.contentService.restore<IPageTranslationContent>(
            PAGE_TRANSLATION_CONTENT_TYPE_ID,
            id,
            actor
        );
        this.onRoutesChanged();

        return this.toTranslation(restored, await this.englishSourceHash(pageId));
    }

    /**
     * Gather what the Suggest button sends to the model for one page and
     * language: the English text, and the existing translation when it is
     * stale, so the model updates it instead of starting over. A current
     * translation is left out because the model would only copy it.
     *
     * @param pageId - The page's core content id.
     * @param language - Language code of the translation being suggested.
     * @returns The source fields and the existing translation's `published` and `ogImage`.
     * @throws ContentError `not-found` when no page has that id.
     */
    async getSuggestionSource(pageId: string, language: string): Promise<IPageTranslationSuggestionSource> {
        const page = await this.requirePage(pageId);
        if (page.deletedAt) {
            throw new ContentError('deleted', 'The page is deleted; restore it before translating it');
        }
        const english = this.toFields(await this.loadEnglishSource(pageId));
        const doc = await this.translations.findOne({ pageId, language, deletedAt: null });
        const [existing] = doc
            ? await this.contentService.readAdmin<IPageTranslationContent>(PAGE_TRANSLATION_CONTENT_TYPE_ID, [doc.contentId])
            : [];
        const stale = existing ? existing.sourceHash !== this.hashFields(english) : false;

        return {
            english,
            previous: existing && stale ? this.toFields(existing) : null,
            published: existing?.published ?? false,
            ogImage: existing?.ogImage ?? ''
        };
    }

    // ============================================================================
    // Public reads
    // ============================================================================

    /** @inheritdoc */
    async renderPublicTranslation(slug: string, language: string): Promise<IPublicPageRender | null> {
        let render: IPublicPageRender | null = null;
        if (LANGUAGE_CODE_PATTERN.test(language)) {
            render = await this.markdown.getCachedTranslationRender(slug, language);
            if (!render) {
                const resolved = await this.resolvePublic(slug, language);
                if (resolved) {
                    const { body } = this.markdown.parseMarkdown(resolved.translation.content);
                    render = {
                        html: await this.markdown.renderMarkdown(body),
                        metadata: {
                            title: resolved.translation.title,
                            description: resolved.translation.description,
                            keywords: resolved.translation.keywords,
                            ogImage: resolved.translation.ogImage ?? resolved.page.ogImage
                        }
                    };
                    await this.markdown.cacheTranslationRender(slug, language, render);
                }
            }
        }

        return render;
    }

    /** @inheritdoc */
    async getPublicTranslationMetadata(slug: string, language: string): Promise<IPublicPageTranslationMetadata | null> {
        const resolved = LANGUAGE_CODE_PATTERN.test(language) ? await this.resolvePublic(slug, language) : null;

        return resolved
            ? {
                title: resolved.translation.title,
                slug: resolved.page.slug,
                description: resolved.translation.description,
                keywords: resolved.translation.keywords,
                ogImage: resolved.translation.ogImage ?? resolved.page.ogImage,
                createdAt: resolved.translation.createdAt,
                updatedAt: resolved.translation.updatedAt
            }
            : null;
    }

    /** @inheritdoc */
    async listLocalizedRoutes(): Promise<IPublicLocalizedRoute[]> {
        const docs = await this.translations
            .find({ deletedAt: null }, { projection: { contentId: 1 } })
            .toArray();
        const served = docs.length > 0
            ? await this.contentService.readPublic<IPageTranslationContent>(
                PAGE_TRANSLATION_CONTENT_TYPE_ID,
                docs.map((doc) => doc.contentId)
            )
            : [];

        const languagesByPage = new Map<string, Set<string>>();
        for (const translation of served.filter((candidate) => candidate.published)) {
            const languages = languagesByPage.get(translation.pageId) ?? new Set<string>();
            languages.add(translation.language);
            languagesByPage.set(translation.pageId, languages);
        }

        const pages = languagesByPage.size > 0
            ? await this.contentService.readPublic<IPageContent>(PAGE_CONTENT_TYPE_ID, [...languagesByPage.keys()])
            : [];

        const routes = new Map<string, Set<string>>();
        for (const page of pages.filter((candidate) => candidate.published)) {
            const languages = languagesByPage.get(page.id) ?? new Set<string>();
            const addresses = [page.slug, ...(page.oldSlugs ?? [])].filter((slug) => LITERAL_SLUG_PATTERN.test(slug));
            for (const address of addresses) {
                const merged = routes.get(address) ?? new Set<string>();
                languages.forEach((language) => merged.add(language));
                routes.set(address, merged);
            }
        }

        return [...routes.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([pattern, languages]) => ({ pattern, languages: [...languages].sort() }));
    }

    // ============================================================================
    // Internals
    // ============================================================================

    /**
     * Find the page an admin route names, at its latest edit.
     *
     * @param pageId - The page's core content id.
     * @returns The page.
     * @throws ContentError `not-found` when no page has that id.
     */
    private async requirePage(pageId: string): Promise<IPage> {
        const page = await this.pages.getPageById(pageId);
        if (!page) {
            throw new ContentError('not-found', `No page with id ${pageId}`);
        }

        return page;
    }

    /**
     * Find the content id of a page's translation into one language.
     *
     * @param pageId - The page's core content id.
     * @param language - Language code of the translation.
     * @returns The translation's core content id.
     * @throws ContentError `not-found` when the page has no translation into that language.
     */
    private async requireTranslationId(pageId: string, language: string): Promise<string> {
        const doc = await this.translations.findOne({ pageId, language });
        if (!doc) {
            throw new ContentError('not-found', `This page has no translation into "${language}"`);
        }

        return doc.contentId;
    }

    /**
     * Find the page and translation a visitor sees for a slug and language.
     * Both must be visible and published on the version core serves.
     *
     * @param slug - The page's current slug.
     * @param language - Language code requested.
     * @returns The pair, or null when either is not served.
     */
    private async resolvePublic(
        slug: string,
        language: string
    ): Promise<{ page: IPage; translation: IPageTranslationContent } | null> {
        let resolved: { page: IPage; translation: IPageTranslationContent } | null = null;
        const page = await this.pages.getPublicPageBySlug(slug);
        const doc = page?.contentId
            ? await this.translations.findOne({ pageId: page.contentId, language, deletedAt: null })
            : null;
        if (page && doc) {
            const [translation] = await this.contentService.readPublic<IPageTranslationContent>(
                PAGE_TRANSLATION_CONTENT_TYPE_ID,
                [doc.contentId]
            );
            if (translation?.published) {
                resolved = { page, translation };
            }
        }

        return resolved;
    }

    /**
     * Fingerprint the English text a translator works from: the version
     * visitors are served, or the latest edit when no version is served yet.
     * Only the translatable parts count — title, description, keywords, and
     * the body — so changing the slug or the published flag does not mark
     * every translation stale.
     *
     * @param pageId - The page's core content id.
     * @returns A SHA-256 hex digest.
     * @throws ContentError `not-found` when no page has that id.
     */
    private async englishSourceHash(pageId: string): Promise<string> {
        return this.hashFields(this.toFields(await this.loadEnglishSource(pageId)));
    }

    /**
     * Fingerprint translatable fields, so two loads of the same English text
     * always produce the same value and any change to it produces another.
     *
     * @param fields - Title, description, keywords, and body.
     * @returns A SHA-256 hex digest.
     */
    private hashFields(fields: IPageTranslationFields): string {
        return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
    }

    /**
     * Load the English text a translator works from: the version visitors are
     * served, or the latest edit when no version is served yet. The stale flag
     * and the Suggest button both use this, so a suggestion is written against
     * the same text the stale check compares with.
     *
     * @param pageId - The page's core content id.
     * @returns The page at that version.
     * @throws ContentError `not-found` when no page has that id.
     */
    private async loadEnglishSource(pageId: string): Promise<IPageContent> {
        const [served] = await this.contentService.readPublic<IPageContent>(PAGE_CONTENT_TYPE_ID, [pageId]);
        const [latest] = served
            ? [served]
            : await this.contentService.readAdmin<IPageContent>(PAGE_CONTENT_TYPE_ID, [pageId]);
        if (!latest) {
            throw new ContentError('not-found', `No page with id ${pageId}`);
        }

        return latest;
    }

    /**
     * Reduce a page or translation to the parts a translator changes, with the
     * frontmatter stripped from the body.
     *
     * @param item - A page or translation read through core.
     * @returns Its title, description, keywords, and body.
     */
    private toFields(item: { title: string; description: string; keywords: string[]; content: string }): IPageTranslationFields {
        return {
            title: item.title,
            description: item.description,
            keywords: item.keywords,
            body: this.markdown.parseMarkdown(item.content).body
        };
    }

    /**
     * Map a translation read through core to the admin API shape.
     *
     * @param translation - The merged core row and translation fields.
     * @param englishHash - Fingerprint of the English text as it is now.
     * @returns The translation, flagged stale when it was written against
     *   different English text.
     */
    private toTranslation(translation: IPageTranslationContent, englishHash: string): IPageTranslation {
        return {
            contentId: translation.id,
            pageId: translation.pageId,
            language: translation.language,
            title: translation.title,
            content: translation.content,
            description: translation.description,
            keywords: translation.keywords,
            published: translation.published,
            ogImage: translation.ogImage,
            stale: translation.sourceHash !== englishHash,
            curation: translation.curation,
            hasApprovedVersion: translation.hasApprovedVersion,
            deletedAt: translation.deletedAt,
            createdAt: translation.createdAt,
            updatedAt: translation.updatedAt
        };
    }
}
