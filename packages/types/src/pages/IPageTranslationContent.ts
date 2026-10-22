/**
 * @file IPageTranslationContent.ts
 *
 * A translation of a CMS page as the core content service returns it: the
 * shared `IContent` fields core stores, merged with the translation fields the
 * pages module stores. This is the shape of the `core:page-translation`
 * managed content type, so a translation is reviewed, audited, and
 * soft-deleted the same way a page is.
 *
 * A translation holds the visitor-facing text of one page in one language. It
 * has no slug of its own: it is served at the page's slug with the language
 * prefix in front, such as `/zh/about` for the Chinese translation of `/about`.
 */

import type { IContent } from '../content/IContent.js';

/**
 * One managed page translation, at whichever version the read asked for.
 */
export interface IPageTranslationContent extends IContent {
    /** Core content id of the page this translates. */
    pageId: string;

    /** Language code of the translation, such as `zh`. Never the default language. */
    language: string;

    /** Translated title, from the frontmatter. */
    title: string;

    /** Full markdown including the frontmatter block. */
    content: string;

    /** Translated SEO description, from the frontmatter. */
    description: string;

    /** Translated SEO keywords, from the frontmatter. */
    keywords: string[];

    /**
     * The translation's own visibility switch, from the frontmatter. Visitors
     * see the translation only when this is true on the version core serves
     * them, so a translator can save drafts without putting them live.
     */
    published: boolean;

    /** Open Graph image URL for this language, from the frontmatter. Falls back to the page's image when absent. */
    ogImage?: string;

    /**
     * Fingerprint of the English page text this translation was written
     * against. When the English page changes, its fingerprint no longer
     * matches and the translation is reported as stale.
     */
    sourceHash: string;
}
