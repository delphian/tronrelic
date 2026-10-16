/**
 * @fileoverview Runs a plugin page's serverDataFetcher during server rendering.
 *
 * Both routes that render plugin pages need this: the root catch-all for public
 * pages and the `/system/plugins/[...slug]` route for admin pages. Keeping one
 * copy means an admin page receives `initialData` under exactly the same rules
 * as a public one, instead of the admin route silently skipping the fetcher.
 */

import 'server-only';
import type { IRegisteredPageConfig } from './IRegisteredPageConfig';
import { buildServerDataContext } from './buildServerDataContext';

/**
 * Run the page's serverDataFetcher, if it declares one, and return its result
 * as plain data ready to pass to the plugin component as `initialData`.
 *
 * This is the server half of the SSR + Live Updates pattern: the plugin's
 * content arrives in the first HTML and the client component initializes its
 * state from the same value after hydration.
 *
 * The result is normalized with a JSON round-trip before it crosses the React
 * Server Components boundary. Date instances become ISO strings, undefined
 * fields are dropped, and class instances, Maps, Sets, and functions become
 * plain objects, rather than throwing React's serialization error after this
 * function has already returned. A fetcher that throws, or a value the
 * round-trip cannot handle (a circular reference or a BigInt), is logged and
 * yields undefined, so the page renders without initialData instead of failing.
 *
 * The fetcher runs without the visitor's cookies, so any admin-gated backend
 * route it calls answers 401. That is what makes it safe to run for admin pages
 * before the system layout has checked the visitor's credentials: it has no
 * more reach than an anonymous caller.
 *
 * @param pageConfig Resolved plugin page whose fetcher should run.
 * @param slug Requested URL path, passed to the fetcher as `ctx.path` so a wildcard page knows which resource was asked for.
 * @param lang The request's `[lang]` route parameter, which sets the language of the fetcher's `ctx.translator`.
 * @returns The fetched data, or undefined when the page declares no fetcher or the fetch failed.
 */
export async function runPluginServerDataFetcher(
    pageConfig: IRegisteredPageConfig,
    slug: string,
    lang: string
): Promise<unknown> {
    let initialData: unknown = undefined;

    if (pageConfig.serverDataFetcher) {
        try {
            const ctx = await buildServerDataContext(pageConfig.pluginId, slug, lang);
            const raw = await pageConfig.serverDataFetcher(ctx);
            initialData = raw === undefined ? undefined : JSON.parse(JSON.stringify(raw));
        } catch (error) {
            console.error(`[plugin-page] serverDataFetcher failed for ${slug}:`, error);
            initialData = undefined;
        }
    }

    return initialData;
}
