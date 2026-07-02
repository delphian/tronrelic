/**
 * @fileoverview Server-side plugin page resolver.
 *
 * Provides server-rendered plugin pages with synchronous-feeling access to plugin
 * page configs from the catch-all route's generateMetadata and body render.
 *
 * Why this exists:
 * The client-side pluginRegistry only stores the page configs in a shape suited
 * for runtime React lookups. This module exposes a server-only read path that
 * filters by the currently-enabled plugin manifest set, ensuring disabled
 * plugins 404 server-side and never leak metadata into the response head.
 *
 * Caching strategy:
 * - The permanent path-to-page-config map is built lazily once from the
 *   synchronously-imported `frontendPlugins` array and reused for the server
 *   process lifetime. Plugin code is statically compiled into the build, so it
 *   cannot change at runtime.
 * - The enabled-plugin-ids fetch uses React's cache() so generateMetadata and
 *   the page body render within a single request share one fetch instead of two.
 * - Disabled plugins return null even if their page is in the permanent map.
 *   This preserves the runtime-disable semantics that the admin UI promises.
 *
 * Server-only:
 * The 'server-only' import causes Next.js to throw a build error if any client
 * component accidentally imports this module. Importing `frontendPlugins`
 * server-side is safe because plugin frontend entry files only import
 * next/dynamic, types, and the manifest — no top-level browser APIs.
 */

import 'server-only';
import { cache } from 'react';
import type { IPageConfig } from '@/types';
import { frontendPlugins } from '../components/plugins/plugins.generated';
import { getServerSideApiUrlWithPath } from './api-url';
import {
    isWildcardPath,
    wildcardPrefix,
    matchPluginPagePath,
    sortWildcardEntries,
    type IWildcardPageEntry
} from './pluginPagePathMatch';

/**
 * A page resolved from a plugin's frontend module, with the owning pluginId
 * pre-attached to the config so callers don't have to track it separately.
 */
interface IResolvedPluginPage {
    pluginId: string;
    config: IPageConfig;
}

/**
 * The process-lifetime page index: exact paths keyed literally, plus wildcard
 * registrations ('/*' suffix) pre-stripped and sorted longest-prefix-first so
 * request-time matching is a first-hit scan.
 */
interface IPluginPageIndex {
    exact: Map<string, IResolvedPluginPage>;
    wildcards: Array<IWildcardPageEntry<IResolvedPluginPage>>;
}

/**
 * Process-lifetime cache of every plugin page declared by every plugin,
 * regardless of enabled state. Built lazily on first call to
 * getEnabledPluginPageConfig.
 */
let permanentIndex: IPluginPageIndex | null = null;

/**
 * Walks the synchronously-imported plugin list and indexes every plugin's
 * pages and adminPages by URL path, separating exact paths from wildcard
 * ('/*' suffix) registrations.
 *
 * Collision policy: first-wins. The first plugin to register a given path
 * keeps it; later plugins are warned and skipped. This matches the
 * client-side `pluginRegistry.getPageByPath` semantics (both sides run the
 * shared matcher in pluginPagePathMatch.ts), so the server and client
 * always resolve the same plugin for any given path — preventing React
 * hydration mismatches when two plugins accidentally collide.
 *
 * @returns The exact-map + sorted-wildcard index covering every plugin's pages
 */
function buildPermanentIndex(): IPluginPageIndex {
    const map = new Map<string, IResolvedPluginPage>();
    const wildcards: Array<IWildcardPageEntry<IResolvedPluginPage>> = [];
    for (const plugin of frontendPlugins) {
        // Defense in depth — the generated registry already filters malformed
        // modules, but a plugin whose pages array contains entries with
        // missing paths would still throw inside the loop and abort SSR for
        // every route. Wrap each plugin so one broken entry only breaks that
        // plugin, never the entire page resolver.
        try {
            const manifest = plugin?.manifest;
            if (!manifest || typeof manifest.id !== 'string' || manifest.id.length === 0) {
                console.error(
                    '[serverPluginRegistry] Skipping registry entry with missing manifest id.'
                );
                continue;
            }
            const pluginId = manifest.id;
            const pages = plugin.pages ?? [];
            const adminPages = plugin.adminPages ?? [];
            for (const page of [...pages, ...adminPages]) {
                if (!page || typeof page.path !== 'string' || page.path.length === 0) {
                    console.error(
                        `[serverPluginRegistry] Plugin '${pluginId}' declared a page with no path; skipping.`
                    );
                    continue;
                }
                const resolved: IResolvedPluginPage = {
                    pluginId,
                    config: { ...page, pluginId }
                };
                if (isWildcardPath(page.path)) {
                    const prefix = wildcardPrefix(page.path);
                    const existingWildcard = wildcards.find(entry => entry.prefix === prefix);
                    if (existingWildcard) {
                        console.warn(
                            `[serverPluginRegistry] Duplicate wildcard page path '${page.path}' detected. ` +
                                `Plugin '${pluginId}' will be ignored; '${existingWildcard.value.pluginId}' keeps the route.`
                        );
                        continue;
                    }
                    wildcards.push({ prefix, value: resolved });
                    continue;
                }
                const existing = map.get(page.path);
                if (existing) {
                    console.warn(
                        `[serverPluginRegistry] Duplicate page path '${page.path}' detected. ` +
                            `Plugin '${pluginId}' will be ignored; '${existing.pluginId}' keeps the route.`
                    );
                    continue;
                }
                map.set(page.path, resolved);
            }
        } catch (error) {
            const pluginId = plugin?.manifest?.id ?? '<unknown>';
            console.error(
                `[serverPluginRegistry] Plugin '${pluginId}' threw while indexing pages; skipping.`,
                error
            );
        }
    }
    return { exact: map, wildcards: sortWildcardEntries(wildcards) };
}

/**
 * Returns the permanent page index, building it on first call.
 * Subsequent calls return the cached index immediately.
 *
 * @returns The permanent exact-map + wildcard page index
 */
function getPermanentIndex(): IPluginPageIndex {
    if (!permanentIndex) {
        permanentIndex = buildPermanentIndex();
    }
    return permanentIndex;
}

/**
 * Per-request cached fetch of the set of currently-enabled plugin ids.
 *
 * Wrapped in React's cache() so generateMetadata and the page body render
 * within a single SSR pass share one fetch. The underlying HTTP response is
 * also revalidated every 60 seconds via Next's data cache so toggling a plugin
 * in the admin UI propagates within a minute without a full server restart.
 *
 * Returns an empty set on failure rather than throwing, so an unreachable
 * backend during SSR degrades gracefully (every plugin page 404s) instead of
 * 500ing the whole site.
 *
 * @returns Set of plugin ids that are currently installed and enabled
 */
const fetchEnabledPluginIds = cache(async (): Promise<Set<string>> => {
    const apiUrl = getServerSideApiUrlWithPath();
    try {
        const response = await fetch(`${apiUrl}/plugins/manifests`, {
            next: { revalidate: 60 }
        });
        if (!response.ok) {
            console.warn(
                `[serverPluginRegistry] Manifests fetch returned HTTP ${response.status}`
            );
            return new Set();
        }
        const data = await response.json();
        const manifests: Array<{ id: string }> = data.manifests ?? [];
        return new Set(manifests.map(m => m.id));
    } catch (error) {
        console.error(
            '[serverPluginRegistry] Failed to fetch enabled plugin manifests:',
            error
        );
        return new Set();
    }
});

/**
 * Look up a plugin page config by URL path, returning it only if the owning
 * plugin is currently enabled.
 *
 * Resolution honors the wildcard convention via the shared matcher: an exact
 * registration wins, then the longest matching '/*' wildcard prefix. The
 * client registry runs the same matcher so SSR and hydration agree.
 *
 * Used by the catch-all route's generateMetadata to populate <head> and by the
 * default page render to await serverDataFetcher and render the plugin component.
 * Returns null when the path is not registered by any plugin OR when the
 * registering plugin is currently disabled — both cases collapse to a 404 in
 * the catch-all route.
 *
 * @param slug - URL path to look up (e.g., '/tools/bazi-fortune', '/blog/my-post')
 * @returns The page config with pluginId attached, or null if not found / disabled
 */
export async function getEnabledPluginPageConfig(
    slug: string
): Promise<IPageConfig | null> {
    const index = getPermanentIndex();
    const resolved = matchPluginPagePath(index.exact, index.wildcards, slug);
    if (!resolved) {
        return null;
    }
    const enabledIds = await fetchEnabledPluginIds();
    if (!enabledIds.has(resolved.pluginId)) {
        return null;
    }
    return resolved.config;
}
