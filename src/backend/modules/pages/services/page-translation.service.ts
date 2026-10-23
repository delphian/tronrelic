/**
 * @fileoverview Public reads of translated CMS pages.
 *
 * The core content service manages translations for every translatable type:
 * it keeps their state, runs the editor and the Suggest request, and lists the
 * translated addresses for the localization snapshot. What only pages knows is
 * how a translation becomes a rendered page, so that stays here. A request for
 * `/zh/about` resolves the English page served at `/about`, asks core for its
 * published Chinese translation, lays the translated values over the page, and
 * renders the translated body, caching the render per slug and language.
 *
 * A page is served in a language only while it has a published, live
 * translation into it, so a missing translation is null here and a 404 to the
 * visitor, never the English body.
 *
 * @module backend/modules/pages/services/page-translation.service
 */

import type {
    ICacheService,
    IContentService,
    IPage,
    IPageContent,
    IPageTranslationService,
    IPublicPageRender,
    IPublicPageTranslationMetadata,
    IServedContentTranslation
} from '@/types';
import { LANGUAGE_CODE_PATTERN } from '@/types';
import { MarkdownService } from './markdown.service.js';
import { PAGE_CONTENT_TYPE_ID } from './page-content-type.js';

/**
 * The page lookup the translation service needs. Declared narrowly so the
 * service depends on what it uses rather than the whole page service.
 */
export interface IPublicPageLookup {
    /**
     * Get the page a visitor sees at a slug.
     *
     * @param slug - The requested path.
     * @returns The visible, published page, or null.
     */
    getPublicPageBySlug(slug: string): Promise<IPage | null>;
}

/** Collaborators wired once at bootstrap. */
export interface IPageTranslationServiceDependencies {
    /** Redis cache for translated renders. */
    cacheService: ICacheService;
    /** The core content service, whose `translations()` serves the translated values. */
    contentService: IContentService;
    /** Resolves the English page a visitor is served at a slug. */
    pages: IPublicPageLookup;
}

/**
 * Singleton implementing `IPageTranslationService`.
 *
 * Singleton because it is a public API over shared state, configured once at
 * bootstrap and consumed by the public page routes.
 */
export class PageTranslationService implements IPageTranslationService {
    private static instance: PageTranslationService | null = null;

    private readonly contentService: IContentService;
    private readonly pages: IPublicPageLookup;
    private readonly markdown: MarkdownService;

    /**
     * Private so construction only happens through `setDependencies`.
     *
     * @param deps - Bootstrap-wired collaborators.
     */
    private constructor(deps: IPageTranslationServiceDependencies) {
        this.contentService = deps.contentService;
        this.pages = deps.pages;
        this.markdown = new MarkdownService(deps.cacheService);
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

    /** @inheritdoc */
    async renderPublicTranslation(slug: string, language: string): Promise<IPublicPageRender | null> {
        // An anonymous caller supplies the language, so it is checked before
        // it becomes part of a cache key.
        let render = LANGUAGE_CODE_PATTERN.test(language)
            ? await this.markdown.getCachedTranslationRender(slug, language)
            : null;
        if (!render && LANGUAGE_CODE_PATTERN.test(language)) {
            const served = await this.resolvePublic(slug, language);
            if (served) {
                const metadata = this.toMetadata(served);
                render = {
                    html: await this.markdown.renderMarkdown(this.text(served, 'body')),
                    metadata: {
                        title: metadata.title,
                        description: metadata.description,
                        keywords: metadata.keywords,
                        ogImage: metadata.ogImage
                    }
                };
                await this.markdown.cacheTranslationRender(slug, language, render);
            }
        }

        return render;
    }

    /** @inheritdoc */
    async getPublicTranslationMetadata(slug: string, language: string): Promise<IPublicPageTranslationMetadata | null> {
        const served = await this.resolvePublic(slug, language);

        return served ? this.toMetadata(served) : null;
    }

    /**
     * Find the English page a visitor is served at a slug, then its published
     * translation into the language. Pages' own rule, that the served version
     * is published, is applied by the page lookup; core applies the rest.
     *
     * @param slug - The page's current slug.
     * @param language - Language code requested.
     * @returns The served translation, or null when the page or the translation is not served.
     */
    private async resolvePublic(slug: string, language: string): Promise<IServedContentTranslation<IPageContent> | null> {
        const page = await this.pages.getPublicPageBySlug(slug);

        return page?.contentId
            ? this.contentService.translations().readPublicTranslation<IPageContent>(PAGE_CONTENT_TYPE_ID, page.contentId, language)
            : null;
    }

    /**
     * Lay the translated values over the English page for the metadata a
     * visitor's page head is built from. An empty social image falls back to
     * the English page's own.
     *
     * @param served - The served translation and its page.
     * @returns The translated page metadata.
     */
    private toMetadata(served: IServedContentTranslation<IPageContent>): IPublicPageTranslationMetadata {
        const keywords = served.values.keywords;
        const ogImage = this.text(served, 'ogImage') || served.item.ogImage;

        return {
            title: this.text(served, 'title'),
            slug: served.item.slug,
            description: this.text(served, 'description'),
            keywords: Array.isArray(keywords) ? keywords : [],
            ...(ogImage ? { ogImage } : {}),
            createdAt: served.createdAt,
            updatedAt: served.updatedAt
        };
    }

    /**
     * Read one text value out of a translation.
     *
     * @param served - The served translation.
     * @param field - The field name.
     * @returns The value, or an empty string when it is missing or a list.
     */
    private text(served: IServedContentTranslation<IPageContent>, field: string): string {
        const value = served.values[field];

        return typeof value === 'string' ? value : '';
    }
}
