/**
 * @file IPageTranslationService.ts
 *
 * Public reads of translated CMS pages. Translations themselves are managed by
 * the core content service (`IContentService.translations()`), which keeps
 * their state and runs the editor, the Suggest request, and the list of
 * translated addresses for every translatable content type. What stays with
 * pages is turning a served translation into a rendered page: laying the
 * translated values over the English page and rendering the translated body,
 * with the render cached per slug and language.
 *
 * A page is served in a language only while it has a published, live
 * translation into it. There is no fallback to English under a translated
 * address.
 */

import type { IPublicPageRender } from './IPublicPageRender.js';
import type { IPublicPageTranslationMetadata } from './IPublicPageTranslationMetadata.js';

/**
 * Translated page reads for the public page routes.
 */
export interface IPageTranslationService {
    /**
     * Render the translation a visitor sees for the page at a slug.
     *
     * @param slug - The page's current slug.
     * @param language - Language code requested.
     * @returns The render, or null when the page or a published, live
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
}
