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

/**
 * A page resolved from a plugin's frontend module, with the owning pluginId
 * pre-attached to the config so callers don't have to track it separately.
 */
interface IResolvedPluginPage {
    pluginId: string;
    config: IPageConfig;
}

/**
 * Process-lifetime cache of every plugin page declared by every plugin,
 * regardless of enabled state. Built lazily on first call to
 * getEnabledPluginPageConfig.
 */
let permanentMap: Map<string, IResolvedPluginPage> | null = null;

/**
 * Walks the synchronously-imported plugin list and indexes every plugin's
 * pages and adminPages by URL path.
 *
 * Collision policy: first-wins. The first plugin to register a given path
 * keeps it; later plugins are warned and skipped. This matches the
 * client-side `pluginRegistry.getPageByPath` semantics (which uses
 * `Array.find` and returns the first match), so the server and client
 * always resolve the same plugin for any given path — preventing React
 * hydration mismatches when two plugins accidentally collide.
 *
 * @returns A path-to-resolved-page map covering every plugin's pages
 */
function buildPermanentMap(): Map<string, IResolvedPluginPage> {
    const map = new Map<string, IResolvedPluginPage>();
    for (const plugin of frontendPlugins) {
        const pluginId = plugin.manifest.id;
        const pages = plugin.pages ?? [];
        const adminPages = plugin.adminPages ?? [];
        for (const page of [...pages, ...adminPages]) {
            const existing = map.get(page.path);
            if (existing) {
                console.warn(
                    `[serverPluginRegistry] Duplicate page path '${page.path}' detected. ` +
                        `Plugin '${pluginId}' will be ignored; '${existing.pluginId}' keeps the route.`
                );
                continue;
            }
            map.set(page.path, {
                pluginId,
                config: { ...page, pluginId }
            });
        }
    }
    return map;
}

/**
 * Returns the permanent path-to-page-config map, building it on first call.
 * Subsequent calls return the cached map immediately.
 *
 * @returns The permanent path-to-resolved-page map
 */
function getPermanentMap(): Map<string, IResolvedPluginPage> {
    if (!permanentMap) {
        permanentMap = buildPermanentMap();
    }
    return permanentMap;
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
 * Used by the catch-all route's generateMetadata to populate <head> and by the
 * default page render to await serverDataFetcher and render the plugin component.
 * Returns null when the path is not registered by any plugin OR when the
 * registering plugin is currently disabled — both cases collapse to a 404 in
 * the catch-all route.
 *
 * @param slug - URL path to look up (e.g., '/tools/bazi-fortune')
 * @returns The page config with pluginId attached, or null if not found / disabled
 */
export async function getEnabledPluginPageConfig(
    slug: string
): Promise<IPageConfig | null> {
    const map = getPermanentMap();
    const resolved = map.get(slug);
    if (!resolved) {
        return null;
    }
    const enabledIds = await fetchEnabledPluginIds();
    if (!enabledIds.has(resolved.pluginId)) {
        return null;
    }
    return resolved.config;
}
