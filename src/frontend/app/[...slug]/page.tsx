import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { cache } from 'react';
import { Page } from '../../components/layout';
import { PluginPageWithZones } from '../../components/PluginPageWithZones';
import { CategoryLandingPage } from '../../modules/menu';
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
 * Menu category node data from the resolve endpoint.
 */
interface ICategoryResolveResponse {
    success: boolean;
    node: {
        _id?: string;
        label: string;
        description?: string;
        url?: string;
        icon?: string;
    };
    children: {
        _id?: string;
        label: string;
        description?: string;
        url: string;
        icon?: string;
    }[];
}

/**
 * Discriminated result from resolving a slug to a page type.
 *
 * The catch-all route must determine which system owns a given URL:
 * custom CMS pages, plugin pages, menu category pages, or nothing.
 * This union type captures that result so both generateMetadata() and
 * the page component resolve the slug exactly once per request via
 * React.cache().
 */
type ISlugResolution =
    | { type: 'custom' }
    | { type: 'plugin'; config: NonNullable<Awaited<ReturnType<typeof getEnabledPluginPageConfig>>> }
    | { type: 'category'; data: ICategoryResolveResponse }
    | { type: 'notFound' };

/**
 * Resolve a slug to its owning page system.
 *
 * Checks in priority order: custom CMS pages, enabled plugin pages, menu
 * category pages. Wrapped with React.cache() so generateMetadata() and
 * the page component share the same result within a single render pass
 * without duplicating API calls.
 *
 * @param slug - URL path to resolve (e.g., '/tools', '/plugins/whale-alerts')
 * @returns Discriminated result indicating which system owns the slug
 */
const resolveSlug = cache(async (slug: string): Promise<ISlugResolution> => {
    const apiUrl = getServerSideApiUrlWithPath();

    // 1. Custom CMS page
    try {
        const response = await fetch(`${apiUrl}/pages/${encodeURIComponent(slug)}`, {
            next: { revalidate: 60 }
        });
        if (response.ok) {
            return { type: 'custom' };
        }
    } catch {
        // Not a custom page — continue
    }

    // 2. Enabled plugin page
    const pluginPage = await getEnabledPluginPageConfig(slug);
    if (pluginPage) {
        return { type: 'plugin', config: pluginPage };
    }

    // 3. Menu category page
    try {
        const response = await fetch(
            `${apiUrl}/menu/resolve?url=${encodeURIComponent(slug)}`,
            { next: { revalidate: 60 } }
        );
        if (response.ok) {
            const data: ICategoryResolveResponse = await response.json();
            if (data.success) {
                return { type: 'category', data };
            }
        }
    } catch {
        // Not a category page — continue
    }

    return { type: 'notFound' };
});

/**
 * Generate metadata for the page.
 *
 * Uses resolveSlug() to determine which system owns the URL, then builds
 * metadata accordingly. The resolution result is cached per request so the
 * page component reuses it without re-fetching.
 *
 * @param params - Next.js route params containing slug array (Promise in Next.js 15+)
 * @returns Metadata object for Next.js
 */
export async function generateMetadata({ params }: { params: Promise<IPageParams> }): Promise<Metadata> {
    const resolvedParams = await params;
    const slug = '/' + resolvedParams.slug.join('/');
    const resolution = await resolveSlug(slug);

    if (resolution.type === 'custom') {
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

    if (resolution.type === 'plugin') {
        const pluginPage = resolution.config;
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

    if (resolution.type === 'category') {
        const category = resolution.data;
        const { siteUrl } = await getServerConfig();
        if (category.node.label && category.node.description) {
            return buildMetadata({
                siteUrl,
                title: category.node.label,
                description: category.node.description,
                path: slug
            });
        }
        return category.node.label ? { title: category.node.label } : {};
    }

    return {};
}

/**
 * Unified catch-all route handler.
 *
 * Uses resolveSlug() to determine which system owns the URL, then renders
 * the appropriate page. The resolution result is shared with generateMetadata()
 * via React.cache() so no duplicate API calls occur.
 *
 * @param params - Next.js route params containing slug array (Promise in Next.js 15+)
 * @returns Rendered page content
 */
export default async function UnifiedPage({ params }: { params: Promise<IPageParams> }) {
    const resolvedParams = await params;
    const slug = '/' + resolvedParams.slug.join('/');
    const resolution = await resolveSlug(slug);

    // Custom CMS page — render server-side with Article structured data
    if (resolution.type === 'custom') {
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

    // Menu category page — auto-generated landing page for container nodes
    if (resolution.type === 'category') {
        return <CategoryLandingPage node={resolution.data.node} items={resolution.data.children} />;
    }

    // No system owns this URL
    if (resolution.type !== 'plugin') {
        notFound();
    }

    const pluginPage = resolution.config;
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
