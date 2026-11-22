/**
 * @fileoverview Shape of the public CMS page metadata endpoint's answer.
 */

/**
 * What `GET /api/pages/:slug` returns. The endpoint sends only these fields:
 * the markdown source stays on the server, and the body arrives already
 * rendered and sanitized from the `/render` endpoint.
 */
export interface IPublicPageResponse {
    page: {
        title: string;
        slug: string;
        description?: string;
        keywords?: string[];
        ogImage?: string;
        createdAt: string;
        updatedAt: string;
    };
    /** The slug the request asked for; differs from `page.slug` when it matched an old slug. */
    requestedSlug: string;
}
