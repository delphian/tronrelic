/**
 * @file IPublicPageTranslationMetadata.ts
 *
 * The public metadata of a translated CMS page. It carries the same fields the
 * English public metadata endpoint returns, so the site's page route builds the
 * document head and the Article structured data the same way for either.
 */

/**
 * What an anonymous caller may see about a translated page besides its body.
 */
export interface IPublicPageTranslationMetadata {
    /** Translated title. */
    title: string;

    /** The page's slug, which a translation shares. */
    slug: string;

    /** Translated SEO description. */
    description?: string;

    /** Translated SEO keywords. */
    keywords?: string[];

    /** Open Graph image, the translation's own or else the page's. */
    ogImage?: string;

    /** When the translation was created. */
    createdAt: Date;

    /** When the translation was last changed. */
    updatedAt: Date;
}
