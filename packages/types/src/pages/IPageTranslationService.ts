/**
 * @file IPageTranslationService.ts
 *
 * The contract for translations of CMS pages. A translation is managed content
 * (`core:page-translation`), so every write passes through the core content
 * service and a non-curator's change waits for review, exactly as a page edit
 * does.
 *
 * Translations are addressed by the page's core content id plus a language
 * code, because a page has at most one translation per language. A page is
 * served in a language only while it has a published, visible translation in
 * it, which is the per-page opt-in: a page without one stays English-only and
 * gets no translated address, `hreflang` link, or sitemap entry.
 */

import type { IContentActor } from '../content/IContentActor.js';
import type { IPublicLocalizedRoute } from '../localization/IPublicLocalizedRoute.js';
import type { IPageTranslation } from './IPageTranslation.js';
import type { IPageTranslationSource } from './IPageTranslationSource.js';
import type { IPublicPageRender } from './IPublicPageRender.js';
import type { IPublicPageTranslationMetadata } from './IPublicPageTranslationMetadata.js';

/**
 * Translation management and public reads for CMS pages.
 */
export interface IPageTranslationService {
    /**
     * List every translation of a page for the admin editor, including
     * soft-deleted ones, each at its latest edit.
     *
     * @param pageId - The page's core content id.
     * @returns The translations, ordered by language code.
     * @throws Error when no page has that id.
     */
    listTranslations(pageId: string): Promise<IPageTranslation[]>;

    /**
     * Get the English text a page's translations are written against, so the
     * editor shows and starts drafts from the same text the stale flag and
     * the Suggest button use.
     *
     * @param pageId - The page's core content id.
     * @returns The English version visitors are served, or the latest edit
     *   when none is served yet, and whether a newer edit is waiting for review.
     * @throws Error when no page has that id.
     */
    getTranslationSource(pageId: string): Promise<IPageTranslationSource>;

    /**
     * Create a page's translation into one language.
     *
     * @param pageId - The page's core content id.
     * @param language - Language code; must not be the default language.
     * @param content - Translated markdown including frontmatter.
     * @param actor - Who is creating it; a non-curator's translation is held for review.
     * @returns The created translation, latest edit.
     */
    createTranslation(pageId: string, language: string, content: string, actor: IContentActor): Promise<IPageTranslation>;

    /**
     * Replace a translation's markdown. Saving also records the English
     * text it now matches, which clears the stale flag.
     *
     * @param pageId - The page's core content id.
     * @param language - Language code of the translation.
     * @param content - New translated markdown including frontmatter.
     * @param actor - Who is making the change.
     * @returns The changed translation, latest edit.
     */
    updateTranslation(pageId: string, language: string, content: string, actor: IContentActor): Promise<IPageTranslation>;

    /**
     * Soft-delete a translation. The page stops being served in that language.
     *
     * @param pageId - The page's core content id.
     * @param language - Language code of the translation.
     * @param actor - Who is deleting it.
     */
    deleteTranslation(pageId: string, language: string, actor: IContentActor): Promise<void>;

    /**
     * Restore a soft-deleted translation.
     *
     * @param pageId - The page's core content id.
     * @param language - Language code of the translation.
     * @param actor - Who is restoring it.
     * @returns The restored translation, latest edit.
     */
    restoreTranslation(pageId: string, language: string, actor: IContentActor): Promise<IPageTranslation>;

    /**
     * Render the translation a visitor sees for the page at a slug.
     *
     * @param slug - The page's current slug.
     * @param language - Language code requested.
     * @returns The render, or null when the page or a visible, published
     *   translation into that language does not exist.
     */
    renderPublicTranslation(slug: string, language: string): Promise<IPublicPageRender | null>;

    /**
     * Read the public metadata of the translation a visitor sees for the page
     * at a slug.
     *
     * @param slug - The page's current slug.
     * @param language - Language code requested.
     * @returns The metadata, or null under the same conditions as `renderPublicTranslation`.
     */
    getPublicTranslationMetadata(slug: string, language: string): Promise<IPublicPageTranslationMetadata | null>;

    /**
     * List the page addresses that have a visible, published translation, as
     * routes for the localization snapshot. Each route is one page's slug or
     * one of its old slugs, so a translated link to a renamed page still
     * reaches the redirect. Languages that are not enabled are filtered out by
     * the localization module, not here.
     *
     * @returns One route per address, never with an empty language list.
     */
    listLocalizedRoutes(): Promise<IPublicLocalizedRoute[]>;
}
