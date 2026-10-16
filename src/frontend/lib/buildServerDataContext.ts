/**
 * @fileoverview Builds the context a plugin page's server fetchers receive.
 *
 * A plugin page can declare a `serverDataFetcher` for its body and a
 * `serverMetadataFetcher` for its `<head>`. Both receive an
 * `IServerDataContext`, and two routes run them: the public catch-all route
 * (both fetchers) and the `/system/plugins/[...slug]` admin route (the data
 * fetcher). Building the context in one place means every fetcher gets the
 * same backend URL, site URL, and translator, so a page's metadata and body
 * cannot disagree about the language they are written in.
 */

import 'server-only';
import type { IServerDataContext } from '@/types';
import { getServerSideApiUrlWithPath } from './api-url';
import { getServerConfig } from './serverConfig';
import { getServerTranslator } from '../modules/localization/server';

/**
 * Build the server data context for one plugin page render.
 *
 * The translator is bound to the plugin's id, the same namespace
 * `context.useTranslation()` uses in the plugin's components, so a key a
 * fetcher translates and the same key rendered in the page body share one
 * stored translation.
 *
 * @param pluginId - Id of the plugin that owns the page; scopes the translator's keys.
 * @param slug - Requested URL path, given to the fetcher as `path` so a wildcard page knows which resource was asked for.
 * @param lang - The `[lang]` route parameter of the request, which decides the translator's language.
 * @returns The context to pass to the page's fetchers.
 */
export async function buildServerDataContext(pluginId: string, slug: string, lang: string): Promise<IServerDataContext> {
    const [{ siteUrl }, translator] = await Promise.all([
        getServerConfig(),
        getServerTranslator(Promise.resolve({ lang }), pluginId)
    ]);

    return {
        apiBaseUrl: getServerSideApiUrlWithPath(),
        siteUrl,
        path: slug,
        translator
    };
}
