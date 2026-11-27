/**
 * @fileoverview Renders a CMS page's body with its structured data.
 *
 * Two routes serve CMS pages: the catch-all route, for any slug no other route
 * owns, and a fixed route that hands its address over to a CMS page once one
 * is approved there, such as `/tools/stake-calculator`. Both render the page
 * through this component so a CMS page looks and reads the same to visitors
 * and search engines whichever route served it.
 *
 * A page built around a required widget, such as the whale tracker, is
 * described as a `WebApplication`; every other page as an `Article`. The
 * breadcrumb trail is worked out by the route with `resolvePageBreadcrumbs`
 * and passed in, so this component stays synchronous and renders in the
 * component workbench.
 *
 * It renders no widget zones of its own: the catch-all wraps it in
 * `CorePageZones`, and a fixed route in the `(core)` group already gets them
 * from that group's layout.
 */

import type { IBreadcrumbItem } from '@/types';
import { listRequiredWidgetTypes, localizePath, serializeInlineJson } from '@/types';
import { Page } from '../../../../components/layout';
import { EmbeddedWidgetContent } from '../../../../components/widgets';
import { buildArticleStructuredData } from '../../../../lib/seo';
import { buildBreadcrumbStructuredData } from '../../../../lib/buildBreadcrumbStructuredData';
import { buildWebApplicationStructuredData } from '../../../../lib/buildWebApplicationStructuredData';
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
    /** The page's breadcrumb trail from `resolvePageBreadcrumbs`; an empty list leaves the breadcrumb data out. */
    breadcrumbs: IBreadcrumbItem[];
    /** The language being rendered, so the structured data names the address this version is served at. */
    language: string;
    /** The site's absolute base URL. */
    siteUrl: string;
}

/**
 * Render a CMS page, with widgets embedded through ` ```widget ` blocks drawn
 * in place on the server.
 *
 * @param props - The rendered page, its metadata, its breadcrumb trail, the language, and the site URL.
 * @returns The page body inside the standard page layout.
 */
export function CmsPageArticle({ render, page, breadcrumbs, language, siteUrl }: ICmsPageArticleProps) {
    // The address this version is served at, prefix included.
    const path = page ? localizePath(page.slug, language) : '';
    // A page that cannot work without a widget is that widget's tool page.
    const isToolPage = listRequiredWidgetTypes(render.html).length > 0;
    let pageJsonLd: object | null = null;
    if (page && isToolPage) {
        pageJsonLd = buildWebApplicationStructuredData({
            siteUrl,
            title: page.title,
            description: page.description,
            path,
            dateModified: page.updatedAt,
            image: page.ogImage,
            keywords: page.keywords
        });
    } else if (page) {
        pageJsonLd = buildArticleStructuredData({
            siteUrl,
            title: page.title,
            description: page.description,
            path,
            datePublished: page.createdAt,
            dateModified: page.updatedAt,
            image: page.ogImage,
            keywords: page.keywords
        });
    }
    const breadcrumbJsonLd = buildBreadcrumbStructuredData(breadcrumbs);

    // The title, description, keywords, and crumb names are stored content,
    // so each block is escaped for an inline script rather than written with
    // JSON.stringify.
    return (
        <Page>
            {pageJsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: serializeInlineJson(pageJsonLd) }}
                />
            )}
            {breadcrumbJsonLd && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: serializeInlineJson(breadcrumbJsonLd) }}
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
