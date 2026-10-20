/**
 * @file IPublicPage.ts
 *
 * A page as a visitor sees it, reduced to what a reader of the content needs.
 * The admin shape (`IPage`) carries review state, redirect history, and the raw
 * markdown with its frontmatter block, none of which a reader of the content
 * should see or has to strip. Public reads that hand a page to code rather than
 * to the renderer, such as the pages AI tools, return this shape instead.
 */

/**
 * One published page, at the version core serves to visitors.
 */
export interface IPublicPage {
    /**
     * Core content id. Null only for a page the adoption migration has not
     * reached yet, which can still be addressed by its slug.
     */
    id: string | null;

    /** URL path the page is served at, for example `/about`. */
    slug: string;

    /** Page title, from the frontmatter. */
    title: string;

    /** SEO description, from the frontmatter. Empty when the page sets none. */
    description: string;

    /** SEO keywords, from the frontmatter. */
    keywords: string[];

    /** Open Graph image URL, from the frontmatter, when the page sets one. */
    ogImage?: string;

    /** The page's markdown body, with the frontmatter block removed. */
    body: string;

    /** When the served version was last changed. */
    updatedAt: Date;
}
