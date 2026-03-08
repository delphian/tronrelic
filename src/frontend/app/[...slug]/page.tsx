import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { Page } from '../../components/layout';
import { PluginPageWithZones } from '../../components/PluginPageWithZones';
import { getServerSideApiUrlWithPath } from '../../lib/api-url';
import { buildMetadata } from '../../lib/seo';
import { getServerConfig } from '../../lib/serverConfig';
import styles from './page.module.css';

/**
 * Static SEO metadata for known plugin pages.
 *
 * Plugin pages are client-rendered and cannot generate their own server-side metadata.
 * This map provides titles, descriptions, and keywords so crawlers see meaningful
 * content in the initial HTML response. Follows the same pattern the sitemap uses
 * to hardcode known plugin slugs.
 */
const PLUGIN_SEO_METADATA: Record<string, { title: string; description: string; keywords: string[] }> = {
    '/resource-markets': {
        title: 'Compare TRON Energy Rental Prices | Live Market Tracker | TronRelic',
        description: 'Compare real-time TRON energy rental prices across 20+ platforms. Find the cheapest rates for TRC-20 USDT transfers and save up to 90% on transaction fees. Updated every 10 minutes.',
        keywords: [
            'rent TRON energy',
            'TRON energy rental',
            'TRC20 transfer fee',
            'cheapest TRON energy',
            'TRON energy market',
            'TronSave',
            'JustLend',
            'energy price comparison',
            'TRX staking'
        ]
    }
};

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
 * Only generates metadata for custom pages (not plugin pages, as they handle
 * their own metadata client-side).
 *
 * @param params - Next.js route params containing slug array (Promise in Next.js 15+)
 * @returns Metadata object for Next.js
 */
export async function generateMetadata({ params }: { params: Promise<IPageParams> }): Promise<Metadata> {
    const resolvedParams = await params;
    const slug = '/' + resolvedParams.slug.join('/');
    const isCustom = await isCustomPage(slug);

    if (!isCustom) {
        const pluginSeo = PLUGIN_SEO_METADATA[slug];
        if (pluginSeo) {
            const { siteUrl } = await getServerConfig();
            return buildMetadata({
                siteUrl,
                title: pluginSeo.title,
                description: pluginSeo.description,
                path: slug,
                keywords: pluginSeo.keywords
            });
        }
        return {};
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

    // If it's a custom page, render it server-side
    if (isCustom) {
        const apiUrl = getServerSideApiUrlWithPath();

        const response = await fetch(`${apiUrl}/pages/${encodeURIComponent(slug)}/render`, {
            next: { revalidate: 60 }
        });

        if (!response.ok) {
            notFound();
        }

        const data: IRenderResponse = await response.json();

        // If requested slug differs from current slug, redirect to current slug
        if (data.requestedSlug !== data.currentSlug) {
            redirect(data.currentSlug);
        }

        return (
            <Page>
                <article>
                    <div
                        className={styles.content}
                        dangerouslySetInnerHTML={{ __html: data.html }}
                    />
                </article>
            </Page>
        );
    }

    // Not a custom page, let plugin handler check the registry
    // PluginPageWithZones wraps with widget zones for cross-plugin content injection
    return <PluginPageWithZones slug={slug} />;
}
