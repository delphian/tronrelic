/**
 * @file IPageContent.ts
 *
 * A page as the core content service returns it: the shared `IContent` fields
 * core stores, merged with the page fields the pages module stores. This is the
 * shape of the `core:page` managed content type, so every create, update, read,
 * delete, and restore of a page goes through core and comes back as one of
 * these.
 */

import type { IContent } from '../content/IContent.js';

/**
 * One managed page, at whichever version the read asked for.
 */
export interface IPageContent extends IContent {
    /** Page title, from the frontmatter. */
    title: string;

    /** URL path the page is served at, for example `/about`. */
    slug: string;

    /** Earlier slugs that redirect to the current one. */
    oldSlugs: string[];

    /** Full markdown including the frontmatter block. */
    content: string;

    /** SEO description, from the frontmatter. */
    description: string;

    /** SEO keywords, from the frontmatter. */
    keywords: string[];

    /**
     * The page's own visibility switch, from the frontmatter. A public reader
     * sees the page only when this is true on the version core serves them.
     */
    published: boolean;

    /** Open Graph image URL, from the frontmatter. */
    ogImage?: string;

    /** Reserved for multi-author support; always null today. */
    authorId: string | null;
}
