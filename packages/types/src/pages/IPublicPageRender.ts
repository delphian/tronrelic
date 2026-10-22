/**
 * @file IPublicPageRender.ts
 *
 * What the public render endpoint returns for a CMS page or one of its
 * translations: the sanitized HTML body and the metadata the document head
 * needs. The English page and a translation share this shape so the site's
 * page route renders either one with the same code.
 */

/**
 * A rendered page, ready for the site to place in the document.
 */
export interface IPublicPageRender {
    /** Sanitized HTML of the markdown body. */
    html: string;

    /** The fields the document head and social cards are built from. */
    metadata: {
        /** Page title. */
        title: string;
        /** SEO description. */
        description?: string;
        /** SEO keywords. */
        keywords?: string[];
        /** Open Graph image URL. */
        ogImage?: string;
    };
}
