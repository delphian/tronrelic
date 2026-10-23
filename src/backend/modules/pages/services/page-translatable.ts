/**
 * @fileoverview The translation side of the `core:page` managed content type.
 *
 * Core runs the translation workflow for every translatable type: it decides
 * who may write, keeps each translation's published flag, stale fingerprint,
 * audit fields, and soft deletion, runs the AI Suggest request, and lists the
 * translated addresses for the localization snapshot. This class supplies only
 * what core cannot know about pages: which fields a translation carries, how
 * to read the English values out of a page, where a page is served, and how to
 * drop a page's render caches. The translated text is kept in the module's own
 * `module_pages_translation_values` collection through the store core hands
 * out.
 *
 * @module backend/modules/pages/services/page-translatable
 */

import type {
    IContentTranslationKey,
    IPageContent,
    ISystemLogService,
    ITranslatableContentType,
    ITranslatableField,
    ITranslationValueRecord,
    ITranslationValueStore,
    TranslationValues
} from '@/types';
import type { MarkdownService } from './markdown.service.js';

/**
 * A slug that can be handed to the localization snapshot as an exact address.
 * Page slugs are sanitized to these characters, but an `oldSlugs` entry comes
 * straight from frontmatter and may hold anything.
 */
const LITERAL_SLUG_PATTERN = /^\/[a-z0-9\-/]*$/;

/**
 * The fields a page translation carries. The order of the first four fixes the
 * stale fingerprint, and matches the order the fingerprint was computed in
 * before translations moved to core, so translations saved then keep their
 * fingerprints.
 */
const PAGE_TRANSLATABLE_FIELDS: ReadonlyArray<ITranslatableField> = [
    { name: 'title', label: 'Title', kind: 'text', required: true },
    {
        name: 'description',
        label: 'Description',
        kind: 'multiline',
        required: false,
        hint: 'Shown to search engines and on social shares.'
    },
    { name: 'keywords', label: 'Keywords', kind: 'string-list', required: false },
    { name: 'body', label: 'Body', kind: 'markdown', required: true },
    {
        name: 'ogImage',
        label: 'Social image',
        kind: 'url',
        required: false,
        hint: 'Leave empty to use the English page’s image.'
    }
];

/**
 * Looks up the slugs a page is stored under, so a translation change can drop
 * the render caches of the address it is served at.
 */
export type PageSlugLookup = (pageId: string) => Promise<string[]>;

/**
 * Makes `core:page` translatable through the core content service.
 */
export class PageTranslatable implements ITranslatableContentType<IPageContent> {
    readonly translatableFields = PAGE_TRANSLATABLE_FIELDS;

    /**
     * @param store - The store core handed out for the module's translation
     *   values collection.
     * @param markdown - Strips the frontmatter from a page body and owns the
     *   render caches.
     * @param slugsForPage - Finds the slugs whose caches a change must drop.
     * @param logger - Scoped logger for cache failures.
     */
    constructor(
        private readonly store: ITranslationValueStore,
        private readonly markdown: MarkdownService,
        private readonly slugsForPage: PageSlugLookup,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Read the English values a translator works from. The body is the
     * markdown without its frontmatter, because the frontmatter fields are
     * translated on their own and the slug is never translated.
     *
     * @param page - The page at the version core chose as the English source.
     * @returns One value per translatable field.
     */
    extractTranslatable(page: IPageContent): TranslationValues {
        return {
            title: page.title,
            description: page.description ?? '',
            keywords: page.keywords ?? [],
            body: this.markdown.parseMarkdown(page.content).body,
            ogImage: page.ogImage ?? ''
        };
    }

    /**
     * List the addresses a page is served at: its slug, and each old slug so
     * a translated link to a renamed page still reaches the redirect. A page
     * whose served version is unpublished is not served at all.
     *
     * @param page - The page at the version visitors are served.
     * @returns The exact paths, or an empty list for an unpublished page.
     */
    listPublicPaths(page: IPageContent): string[] {
        const paths = page.published ? [page.slug, ...(page.oldSlugs ?? [])] : [];

        return paths.filter((path) => LITERAL_SLUG_PATTERN.test(path));
    }

    /**
     * Load stored translations from the module's values collection.
     *
     * @param keys - The translations to load.
     * @returns One record per stored translation.
     */
    async readTranslations(keys: ReadonlyArray<IContentTranslationKey>): Promise<ITranslationValueRecord[]> {
        return this.store.read(keys);
    }

    /**
     * Store a translation's values. Core has already checked the shapes and
     * the required fields, and pages has no rule of its own to add.
     *
     * @param id - Core content id of the page.
     * @param language - Language code of the translation.
     * @param values - The translated values.
     */
    async writeTranslation(id: string, language: string, values: TranslationValues): Promise<void> {
        await this.store.write(id, language, values);

        return;
    }

    /**
     * Drop the page's render caches, so the next visitor in any language is
     * served whatever core now resolves. Dropping a slug's caches drops every
     * language's render at that slug. Best-effort and never throws, because
     * the change is already stored and a stale render expires with its TTL.
     *
     * @param id - Core content id of the page.
     */
    async onTranslationChanged(id: string): Promise<void> {
        try {
            const slugs = await this.slugsForPage(id);
            await Promise.all(slugs.map((slug) => this.markdown.invalidateAllCaches(slug)));
        } catch (error) {
            this.logger.warn(
                { pageId: id, error },
                'Page translation render cache invalidation failed; stale render will expire with the cache TTL'
            );
        }

        return;
    }
}
