import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PluginPageHandler } from '../../components/PluginPageHandler';
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
}

/**
 * Dynamic route params.
 */
interface IPageParams {
    slug: string[];
}

/**
 * Check if a path is a registered plugin page.
 *
 * This runs server-side and cannot access the client-side plugin registry,
 * so we need to check by attempting to fetch from the custom pages API.
 * If the custom page API returns 404, we assume it might be a plugin page
 * and let the client-side handler check the plugin registry.
 */
async function isCustomPage(slug: string): Promise<boolean> {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

    try {
        const response = await fetch(`${apiUrl}/pages/${encodeURIComponent(slug)}`, {
            next: { revalidate: 60 },
            cache: 'no-store' // Don't cache the check itself
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
 * @param params - Next.js route params containing slug array
 * @returns Metadata object for Next.js
 */
export async function generateMetadata({ params }: { params: IPageParams }): Promise<Metadata> {
    const slug = '/' + params.slug.join('/');
    const isCustom = await isCustomPage(slug);

    if (!isCustom) {
        return {}; // Plugin pages handle their own metadata
    }

    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

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
 * @param params - Next.js route params containing slug array
 * @returns Rendered page content
 */
export default async function UnifiedPage({ params }: { params: IPageParams }) {
    const slug = '/' + params.slug.join('/');
    const isCustom = await isCustomPage(slug);

    // If it's a custom page, render it server-side
    if (isCustom) {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

        try {
            const response = await fetch(`${apiUrl}/pages/${encodeURIComponent(slug)}/render`, {
                next: { revalidate: 60 }
            });

            if (!response.ok) {
                notFound();
            }

            const data: IRenderResponse = await response.json();

            return (
                <div className="page">
                    <article className={styles.article}>
                        <div
                            className={styles.content}
                            dangerouslySetInnerHTML={{ __html: data.html }}
                        />
                    </article>
                </div>
            );
        } catch (error) {
            console.error('Failed to fetch custom page:', error);
            notFound();
        }
    }

    // Not a custom page, let plugin handler check the registry
    return <PluginPageHandler slug={slug} />;
}
