/**
 * @fileoverview Renders a CMS page's body with its Article structured data.
 *
 * Two routes serve CMS pages: the catch-all route, for any slug no other route
 * owns, and a fixed route that hands its address over to a CMS page once one
 * is approved there, such as `/tools/stake-calculator`. Both render the page
 * through this component so a CMS page looks and reads the same to visitors
 * and search engines whichever route served it.
 *
 * It renders no widget zones of its own: the catch-all wraps it in
 * `CorePageZones`, and a fixed route in the `(core)` group already gets them
 * from that group's layout.
 */

import { localizePath, serializeInlineJson } from '@/types';
import { Page } from '../../../../components/layout';
import { EmbeddedWidgetContent } from '../../../../components/widgets';
import { buildArticleStructuredData } from '../../../../lib/seo';
import type { IPublicPageRenderResponse } from '../../types/IPublicPageRenderResponse';
import type { IPublicPageResponse } from '../../types/IPublicPageResponse';
import styles from './CmsPageArticle.module.scss';

/**
 * Props for {@link CmsPageArticle}.
 */
interface ICmsPageArticleProps {
    /** The rendered body and embed data from the render endpoint. */
    render: IPublicPageRenderResponse;
    /** The page's metadata, for structured data; null when it could not be read, which leaves the structured data out. */
    page: IPublicPageResponse['page'] | null;
    /** The language being rendered, so the structured data names the address this version is served at. */
    language: string;
    /** The site's absolute base URL. */
    siteUrl: string;
}

/**
 * Render a CMS page as an article, with widgets embedded through ` ```widget `
 * blocks drawn in place on the server.
 *
 * @param props - The rendered page, its metadata, the language, and the site URL.
 * @returns The page body inside the standard page layout.
 */
export function CmsPageArticle({ render, page, language, siteUrl }: ICmsPageArticleProps) {
    const articleJsonLd = page
        ? buildArticleStructuredData({
            siteUrl,
            title: page.title,
            description: page.description,
            // The address this version is served at, prefix included.
            path: localizePath(page.slug, language),
            datePublished: page.createdAt,
            dateModified: page.updatedAt,
            image: page.ogImage,
            keywords: page.keywords
        })
        : null;

    return (
        <Page>
            {articleJsonLd && (
                <script
                    type="application/ld+json"
                    // The title, description, and keywords are stored page
                    // content, so they are escaped for an inline script rather
                    // than written with JSON.stringify.
                    dangerouslySetInnerHTML={{ __html: serializeInlineJson(articleJsonLd) }}
                />
            )}
            <article>
                <EmbeddedWidgetContent
                    className={styles.content}
                    html={render.html}
                    embeds={render.embeds}
                    route={render.currentSlug}
                    params={{ slug: render.currentSlug.replace(/^\//, '') }}
                />
            </article>
        </Page>
    );
}
