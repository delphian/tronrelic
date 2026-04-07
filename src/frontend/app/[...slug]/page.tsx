import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Page } from '../../components/layout';
import { PluginPageWithZones } from '../../components/PluginPageWithZones';
import { getServerSideApiUrlWithPath } from '../../lib/api-url';
import { buildMetadata, buildArticleStructuredData } from '../../lib/seo';
import { getServerConfig } from '../../lib/serverConfig';
import { getEnabledPluginPageConfig } from '../../lib/serverPluginRegistry';
import styles from './page.module.css';

/**
 * Page metadata response from backend.
 */
interface IPageResponse {
    page: {
        title: string;
        slug: string;
        content: string;
        description?: string;
        keywords?: string[];
        published: boolean;
        ogImage?: string;
        createdAt: string;
        updatedAt: string;
    };
    requestedSlug: string;
}

/**
 * Rendered HTML response from backend.
 */
interface IRenderResponse {
    html: string;
    metadata: {
        title: string;
        description?: string;
        keywords?: string[];
        ogImage?: string;
    };
    currentSlug: string;
    requestedSlug: string;
}

/**
 * Dynamic route params.
 */
interface IPageParams {
    slug: string[];
}

/**
 * Check if a path matches a custom page in the database.
 *
 * This runs server-side and cannot access the client-side plugin registry,
 * so we need to check by attempting to fetch from the custom pages API.
 * If the custom page API returns 404, we assume it might be a plugin page
 * and let the client-side handler check the plugin registry.
 */
async function isCustomPage(slug: string): Promise<boolean> {
    const apiUrl = getServerSideApiUrlWithPath();

    try {
        const response = await fetch(`${apiUrl}/pages/${encodeURIComponent(slug)}`, {
            next: { revalidate: 60 }
        });

        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Generate metadata for the page.
 *
 * Resolves metadata in priority order:
 * 1. Custom pages (database-backed CMS): fetched from /api/pages
 * 2. Enabled plugin pages: read from the plugin's IPageConfig via the
 *    server-side plugin registry, then composed via buildMetadata()
 * 3. Otherwise: empty metadata (Next.js applies the layout-level defaults)
 *
 * Plugin SEO is now declared per-page in each plugin's frontend.ts page config
 * (title, description, keywords, ogImage, ogType, structuredData, noindex).
 * The hardcoded PLUGIN_SEO_METADATA map this used to live in has been removed.
 *
 * @param params - Next.js route params containing slug array (Promise in Next.js 15+)
 * @returns Metadata object for Next.js
 */
export async function generateMetadata({ params }: { params: Promise<IPageParams> }): Promise<Metadata> {
    const resolvedParams = await params;
    const slug = '/' + resolvedParams.slug.join('/');
    const isCustom = await isCustomPage(slug);

    if (!isCustom) {
        const pluginPage = await getEnabledPluginPageConfig(slug);
        if (!pluginPage) {
            return {};
        }

        const { siteUrl } = await getServerConfig();
        let metadata: Metadata;

        // When both title and description are present, emit the full SEO
        // bundle via the shared buildMetadata helper (canonical, openGraph,
        // twitter card, keywords). For pages that declare only a subset of
        // fields, fall through to a fields-only path that emits whatever
        // was actually declared. Either way, noindex is honored below
        // independently of which other fields are present.
        if (pluginPage.title && pluginPage.description) {
            metadata = buildMetadata({
                siteUrl,
                title: pluginPage.title,
                description: pluginPage.description,
                path: slug,
                image: pluginPage.ogImage,
                type: pluginPage.ogType,
                keywords: pluginPage.keywords,
                canonical: pluginPage.canonical
            });
        } else {
            metadata = {};
            if (pluginPage.title) {
                metadata.title = pluginPage.title;
            }
            if (pluginPage.description) {
                metadata.description = pluginPage.description;
            }
            if (pluginPage.keywords) {
                metadata.keywords = pluginPage.keywords;
            }
            if (pluginPage.canonical) {
                metadata.alternates = { canonical: pluginPage.canonical };
            }
            // Build openGraph only when at least one OG-relevant field is
            // present, so we don't synthesize an empty default OG block for
            // pages that explicitly opted out by omitting all SEO fields.
            if (pluginPage.title || pluginPage.description || pluginPage.ogImage || pluginPage.ogType) {
                metadata.openGraph = {
                    type: pluginPage.ogType ?? 'website',
                    ...(pluginPage.title ? { title: pluginPage.title } : {}),
                    ...(pluginPage.description ? { description: pluginPage.description } : {}),
                    ...(pluginPage.canonical ? { url: pluginPage.canonical } : {}),
                    ...(pluginPage.ogImage
                        ? {
                            images: [{
                                url: pluginPage.ogImage,
                                width: 1200,
                                height: 630,
                                alt: pluginPage.title ?? 'TronRelic'
                            }]
                        }
                        : {})
                };
            }
        }

        // noindex applies independently of which other fields are present —
        // admin pages frequently set noindex without bothering to populate
        // crawler-friendly title/description copy.
        if (pluginPage.noindex) {
            metadata.robots = { index: false, follow: false };
        }

        return metadata;
    }

    const apiUrl = getServerSideApiUrlWithPath();

    try {
        const response = await fetch(`${apiUrl}/pages/${encodeURIComponent(slug)}`, {
            next: { revalidate: 60 }
        });

        if (!response.ok) {
            return {};
        }

        const data: IPageResponse = await response.json();
        const { page } = data;

        return {
            title: page.title,
            description: page.description,
            keywords: page.keywords,
            openGraph: {
                title: page.title,
                description: page.description,
                images: page.ogImage ? [page.ogImage] : undefined
            },
            twitter: {
                card: 'summary_large_image',
                title: page.title,
                description: page.description,
                images: page.ogImage ? [page.ogImage] : undefined
            }
        };
    } catch (error) {
        console.error('Failed to fetch page metadata:', error);
        return {};
    }
}

/**
 * Unified catch-all route handler.
 *
 * Handles both plugin pages and custom user-created pages:
 * 1. First checks if it's a custom page in the database
 * 2. If not, renders the plugin page handler (which checks plugin registry)
 * 3. Plugin handler shows 404 if neither exists
 *
 * This allows both systems to coexist at root level URLs.
 *
 * @param params - Next.js route params containing slug array (Promise in Next.js 15+)
 * @returns Rendered page content
 */
export default async function UnifiedPage({ params }: { params: Promise<IPageParams> }) {
    const resolvedParams = await params;
    const slug = '/' + resolvedParams.slug.join('/');
    const isCustom = await isCustomPage(slug);

    // If it's a custom page, render it server-side with Article structured data
    if (isCustom) {
        const apiUrl = getServerSideApiUrlWithPath();
        const encodedSlug = encodeURIComponent(slug);

        // Fetch rendered HTML and page metadata in parallel
        const [renderResponse, pageResponse] = await Promise.all([
            fetch(`${apiUrl}/pages/${encodedSlug}/render`, { next: { revalidate: 60 } }),
            fetch(`${apiUrl}/pages/${encodedSlug}`, { next: { revalidate: 60 } })
        ]);

        if (!renderResponse.ok) {
            notFound();
        }

        const renderData: IRenderResponse = await renderResponse.json();

        // If requested slug differs from current slug, redirect to current slug
        if (renderData.requestedSlug !== renderData.currentSlug) {
            redirect(renderData.currentSlug);
        }

        // Build Article structured data from page metadata (dates, description)
        let articleJsonLd: Record<string, unknown> | null = null;
        if (pageResponse.ok) {
            const pageData: IPageResponse = await pageResponse.json();
            const { siteUrl } = await getServerConfig();
            articleJsonLd = buildArticleStructuredData({
                siteUrl,
                title: pageData.page.title,
                description: pageData.page.description,
                path: pageData.page.slug,
                datePublished: pageData.page.createdAt,
                dateModified: pageData.page.updatedAt,
                image: pageData.page.ogImage,
                keywords: pageData.page.keywords
            });
        }

        return (
            <Page>
                {articleJsonLd && (
                    <script
                        type="application/ld+json"
                        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
                    />
                )}
                <article>
                    <div
                        className={styles.content}
                        dangerouslySetInnerHTML={{ __html: renderData.html }}
                    />
                </article>
            </Page>
        );
    }

    // Not a custom page — look up an enabled plugin page in the server-side
    // registry. Disabled plugins and unknown URLs both return null and 404
    // server-side, so the HTTP status code is correct (200 → only for real
    // pages) and disabled plugin URLs disappear from search engine indexes.
    const pluginPage = await getEnabledPluginPageConfig(slug);
    if (!pluginPage) {
        notFound();
    }

    const pluginStructuredData = pluginPage.structuredData ?? null;

    // If the plugin declares a serverDataFetcher, run it server-side and pass
    // the result to the plugin component as `initialData`. This is the SSR +
    // Live Updates pattern for plugin pages — the plugin's body content arrives
    // in the initial HTML so crawlers see it without executing JavaScript, and
    // the client component initializes its state from the same data after
    // hydration.
    //
    // The fetched value is normalized via JSON round-trip before being passed
    // across the RSC boundary. This guarantees the value is plain-data
    // serializable: Date instances become ISO strings, undefined fields are
    // dropped, and class instances / Map / Set / functions are coerced to
    // empty objects rather than throwing the React serialization error after
    // this try/catch has already returned. Round-trip failures (circular refs,
    // BigInt, etc.) are caught and degrade gracefully — the page renders
    // without initialData rather than 500ing, matching what the docstring
    // and IPageConfig comment promise plugin authors.
    let initialData: unknown = undefined;
    if (pluginPage.serverDataFetcher) {
        try {
            const { siteUrl } = await getServerConfig();
            const raw = await pluginPage.serverDataFetcher({
                apiBaseUrl: getServerSideApiUrlWithPath(),
                siteUrl
            });
            initialData = raw === undefined ? undefined : JSON.parse(JSON.stringify(raw));
        } catch (error) {
            console.error(
                `[catch-all] serverDataFetcher failed for ${slug}:`,
                error
            );
            initialData = undefined;
        }
    }

    // PluginPageWithZones wraps with widget zones for cross-plugin content injection.
    // The structured data JSON is escaped so any string value containing
    // '</script>' (or any '<') can't break out of the script tag and become an
    // injection vector. Replacing '<' with the unicode escape '\u003c' is
    // sufficient because JSON.stringify never emits unescaped '\u003c' on its
    // own and the JSON parser still treats the escape as a literal '<'.
    const pluginStructuredDataJson = pluginStructuredData
        ? JSON.stringify(pluginStructuredData).replace(/</g, '\\u003c')
        : null;

    return (
        <>
            {pluginStructuredDataJson && (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: pluginStructuredDataJson }}
                />
            )}
            <PluginPageWithZones slug={slug} initialData={initialData} />
        </>
    );
}
