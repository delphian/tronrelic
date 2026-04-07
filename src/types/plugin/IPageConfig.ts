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

    /** URL path (e.g., '/whales', '/my-plugin/settings') */
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
        initialData?: any;
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
     * Optional canonical URL override. Defaults to the page's `path`.
     * Set this when the page is reachable from multiple paths and you want
     * search engines to consolidate signals to one canonical URL.
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
