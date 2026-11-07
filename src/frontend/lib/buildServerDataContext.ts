/**
 * @fileoverview Builds the context a plugin page's server fetchers receive.
 *
 * A plugin page can declare a `serverDataFetcher` for its body and a
 * `serverMetadataFetcher` for its `<head>`. Both receive an
 * `IServerDataContext`, and two routes run them: the public catch-all route
 * (both fetchers) and the `/system/plugins/[...slug]` admin route (the data
 * fetcher). Building the context in one place means every fetcher gets the
 * same backend URL, site URL, translator, link localizer, and forwarded
 * visitor headers, so a
 * page's metadata and body cannot disagree about the language they are
 * written in, and every backend call they make is attributed to the visitor.
 */

import 'server-only';
import { headers } from 'next/headers';
import type { IServerDataContext } from '@/types';
import { localizeHref } from '@/types';
import { getServerSideApiUrlWithPath } from './api-url';
import { getServerConfig } from './serverConfig';
import { resolveVisitorForwardedFor } from './resolveVisitorForwardedFor';
import { fetchLocalizationSeed, getServerTranslator } from '../modules/localization/server';

/**
 * Build the server data context for one plugin page render.
 *
 * The translator is bound to the plugin's id, the same namespace
 * `context.useTranslation()` uses in the plugin's components, so a key a
 * fetcher translates and the same key rendered in the page body share one
 * stored translation.
 *
 * `forwardedHeaders` carries the visitor's address. A fetcher's backend call
 * leaves from this container, so without it a per-IP rate limiter on the
 * route counts every visitor as one client, and anyone loading the page fast
 * enough would lock every other visitor out of it.
 *
 * `localizeHref` is bound to the request's language and the public
 * localization snapshot, so a fetcher linking to another page gets the
 * translated address only where that page is published in the language. The
 * seed it reads is the same one `getServerTranslator` reads, and both go
 * through the Next.js fetch cache, so the second read costs no backend call.
 *
 * @param pluginId - Id of the plugin that owns the page; scopes the translator's keys.
 * @param slug - Requested URL path, given to the fetcher as `path` so a wildcard page knows which resource was asked for.
 * @param lang - The `[lang]` route parameter of the request, which decides the translator's language.
 * @returns The context to pass to the page's fetchers.
 */
export async function buildServerDataContext(pluginId: string, slug: string, lang: string): Promise<IServerDataContext> {
    const [{ siteUrl }, translator, { language, config }, requestHeaders] = await Promise.all([
        getServerConfig(),
        getServerTranslator(Promise.resolve({ lang }), pluginId),
        fetchLocalizationSeed(lang),
        headers()
    ]);

    const forwardedFor = resolveVisitorForwardedFor(requestHeaders);
    const forwardedHeaders: Record<string, string> = forwardedFor ? { 'x-forwarded-for': forwardedFor } : {};

    /**
     * Localize one link for this request, so a plugin fetcher never links a
     * translated page to an address that is not published in its language.
     *
     * @param href - The link as the fetcher would write it on an English page, such as `/`.
     * @returns The translated address when the target is published in the request's language, otherwise `href` unchanged.
     */
    const localizeRequestHref = (href: string): string => localizeHref(href, language, config);

    return {
        apiBaseUrl: getServerSideApiUrlWithPath(),
        siteUrl,
        path: slug,
        translator,
        localizeHref: localizeRequestHref,
        forwardedHeaders
    };
}
