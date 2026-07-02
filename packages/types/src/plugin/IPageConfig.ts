import type { ComponentType } from 'react';
import type { IFrontendPluginContext } from './IFrontendPluginContext.js';

/**
 * Server-side context provided to a plugin page's `serverDataFetcher` during SSR.
 *
 * Plugins use these values to construct URLs for backend fetches without
 * importing frontend internals or hardcoding environment variables. The context
 * is built by the catch-all route immediately before invoking serverDataFetcher
 * and reflects the request-time runtime configuration.
 */
export interface IServerDataContext {
    /**
     * Backend API base URL for server-side fetches, including the /api suffix.
     * In Docker deployments this resolves to the internal Docker network URL
     * (e.g. http://backend:4000/api); locally it's http://localhost:4000/api.
     */
    apiBaseUrl: string;

    /**
     * Public site URL from runtime config (e.g., https://tronrelic.com).
     * Use this when building absolute URLs in fetched data.
     */
    siteUrl: string;

    /**
     * The actual URL path being rendered (e.g., '/blog/my-post').
     *
     * Essential for wildcard pages, whose registered `path` (e.g. '/blog/*')
     * does not identify the concrete resource requested — fetchers derive
     * route parameters by stripping their declared prefix from this value.
     * Optional so plugins compiled against older core versions (which did not
     * supply it) still typecheck; current core always populates it.
     */
    path?: string;
}

/**
 * Dynamic SEO metadata returned by a page's `serverMetadataFetcher`.
 *
 * Static `IPageConfig` SEO fields describe a page whose content is fixed at
 * registration time. A wildcard page renders a different resource per URL, so
 * its metadata must be computed per request. This shape mirrors the static
 * fields; values returned here override the corresponding static field.
 */
export interface IPluginPageMetadata {
    /** Page title for <title>, og:title, and twitter:title. */
    title?: string;

    /** Page description for <meta description>, og:description, and twitter:description. */
    description?: string;

    /** SEO keywords for <meta name="keywords">. */
    keywords?: string[];

    /** Open Graph image URL (relative to siteUrl or absolute). */
    ogImage?: string;

    /** Open Graph type; use 'article' for time-stamped content. */
    ogType?: 'website' | 'article';

    /** Canonical URL override for search-engine signal consolidation. */
    canonical?: string;

    /** If true, instructs search engines not to index this page. */
    noindex?: boolean;

    /** Schema.org JSON-LD injected as a <script type="application/ld+json"> tag. */
    structuredData?: Record<string, unknown>;
}

/**
 * Page configuration for plugin routes.
 *
 * Defines routable pages provided by a plugin. Each page config maps a URL path
 * to a React component, enabling plugins to own their full-stack features including
 * UI presentation, SEO metadata, and server-side data fetching without modifying
 * core routing infrastructure.
 *
 * Plugin page components receive an IFrontendPluginContext prop containing UI
 * components, API client, WebSocket access, and other utilities needed to build
 * features without importing from the frontend app. They optionally receive
 * `initialData` produced server-side by `serverDataFetcher`, enabling true SSR
 * of plugin pages.
 *
 * SEO fields (title, description, keywords, ogImage, structuredData) are read
 * server-side by the catch-all route's generateMetadata function and injected
 * into the page <head>. This means crawlers and social link previewers see fully
 * populated metadata without executing JavaScript.
 */
export interface IPageConfig {
    /** Plugin identifier (set automatically by the registry) */
    pluginId?: string;

    /**
     * URL path (e.g., '/whales', '/my-plugin/settings').
     *
     * A path ending in '/*' registers a wildcard page (e.g. '/blog/*') that
     * matches any strictly deeper path — '/blog/*' matches '/blog/my-post'
     * and '/blog/2026/recap' but never '/blog' itself (register '/blog'
     * separately for the index page). Exact registrations always win over
     * wildcards; among overlapping wildcards the longest prefix wins.
     * Wildcard pages should pair `serverDataFetcher`/`serverMetadataFetcher`
     * with `IServerDataContext.path` to resolve the concrete resource.
     */
    path: string;

    /**
     * React component to render for this route.
     *
     * The component receives IFrontendPluginContext as a prop, providing access
     * to UI components, charts, API client, and WebSocket for real-time updates.
     * It optionally receives `initialData` produced by `serverDataFetcher` —
     * plugins that pre-fetch data server-side should accept this prop and use
     * it as initial state instead of fetching in useEffect.
     *
     * @example
     * ```typescript
     * function MyPage({ context, initialData }: { context: IFrontendPluginContext; initialData?: { items: Item[] } }) {
     *     const { ui, api, websocket } = context;
     *     const [items, setItems] = useState(initialData?.items ?? []);
     *     return <ui.Card>...</ui.Card>;
     * }
     * ```
     */
    component: ComponentType<{
        context: IFrontendPluginContext;
        /**
         * SSR-fetched data forwarded by the catch-all route from
         * `serverDataFetcher`. Typed as `unknown` so plugin authors are
         * forced to narrow (cast or runtime-validate) before use, rather
         * than silently relying on a shape the fetcher might not return.
         */
        initialData?: unknown;
    }>;

    /**
     * Optional async function to fetch initial data server-side before rendering.
     *
     * If defined, the catch-all route awaits this during SSR and passes the result
     * as the `initialData` prop to the page component. This enables full server-side
     * rendering of plugin pages — the data appears in the initial HTML so crawlers
     * see it without executing JavaScript, and users see no loading flash.
     *
     * The function receives an IServerDataContext containing the backend API URL
     * and the public site URL, so plugins can fetch from their own backend without
     * importing frontend internals or hardcoding environment variables.
     *
     * The returned data must be JSON-serializable because it crosses the React
     * Server Components boundary. Functions, class instances, Maps, Sets, and
     * component references will fail. Stick to plain objects, arrays, strings,
     * numbers, booleans, and null.
     *
     * Errors thrown by this function are caught and logged; the page renders
     * without initialData rather than 500ing.
     *
     * @example
     * ```typescript
     * serverDataFetcher: async (ctx) => {
     *     const response = await fetch(`${ctx.apiBaseUrl}/plugins/my-plugin/data`);
     *     const data = await response.json();
     *     return { items: data.items };
     * }
     * ```
     */
    serverDataFetcher?: (ctx: IServerDataContext) => Promise<unknown>;

    /**
     * Optional async function computing per-request SEO metadata during SSR.
     *
     * Static SEO fields cannot describe a wildcard page's concrete resource
     * (a specific blog post, a specific record), so crawlers would see one
     * generic title for every URL. When defined, the catch-all route invokes
     * this before rendering and merges the returned fields over the static
     * ones for <head> generation.
     *
     * Returning `null` is an authoritative "resource not found": the route
     * emits noindex metadata and renders a 404. Only return `null` when the
     * backend definitively reported the resource absent (e.g. HTTP 404).
     * Throw on transient failures instead — thrown errors are caught and the
     * route falls back to the static fields, so a brief backend outage never
     * serves 404s to crawlers.
     */
    serverMetadataFetcher?: (ctx: IServerDataContext) => Promise<IPluginPageMetadata | null>;

    /** Page title for SEO. Used in <title>, og:title, and twitter:title. */
    title?: string;

    /** Page description for SEO. Used in <meta description>, og:description, and twitter:description. */
    description?: string;

    /** SEO keywords. Used in <meta name="keywords">. */
    keywords?: string[];

    /**
     * Open Graph image URL for social link previews (Facebook, Twitter, Slack, Discord).
     * Can be a relative path (resolved against siteUrl) or an absolute URL.
     * Recommended dimensions: 1200x630.
     */
    ogImage?: string;

    /**
     * Open Graph type. Defaults to 'website'.
     * Use 'article' for time-stamped content like blog posts or news.
     */
    ogType?: 'website' | 'article';

    /**
     * Optional canonical URL override.
     * Set this when the page is reachable from multiple paths and you want
     * search engines to consolidate signals to one canonical URL. If omitted,
     * this page config does not request an explicit canonical override and
     * the catch-all route emits no `<link rel="canonical">` for the page.
     */
    canonical?: string;

    /**
     * If true, instructs search engines not to index this page.
     * Use for admin pages, settings screens, and transient content.
     */
    noindex?: boolean;

    /**
     * Schema.org structured data (JSON-LD) for rich search results.
     * Injected as a <script type="application/ld+json"> tag in the page head.
     *
     * @example
     * ```typescript
     * structuredData: {
     *     '@context': 'https://schema.org',
     *     '@type': 'WebApplication',
     *     name: 'My Plugin',
     *     applicationCategory: 'FinanceApplication',
     *     offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
     * }
     * ```
     */
    structuredData?: Record<string, unknown>;

    /** Whether this page requires authentication */
    requiresAuth?: boolean;

    /** Whether this page requires admin privileges */
    requiresAdmin?: boolean;
}
