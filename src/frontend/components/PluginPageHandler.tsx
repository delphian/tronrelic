'use client';

import { useMemo } from 'react';
import { pluginRegistry } from '../lib/pluginRegistry';
import { createPluginContext } from '../lib/frontendPluginContext';

interface PluginPageHandlerProps {
    slug: string;
    initialData?: unknown;
}

/**
 * Plugin page handler component.
 *
 * Looks up a plugin page synchronously from the eagerly-bootstrapped plugin
 * registry and renders it with plugin-specific context. The registry is
 * populated at module load by `pluginRegistry.bootstrap()` (called from
 * pluginRegistry.ts as a top-level side effect of importing
 * plugins.generated.ts), so the lookup always resolves immediately on both the
 * SSR pass and the client hydration pass — no useEffect, no polling, no
 * loading flash.
 *
 * Receives optional `initialData` from the catch-all route's serverDataFetcher
 * pipeline and forwards it to the plugin component as a prop, enabling true
 * server-side rendering of plugin page bodies.
 *
 * Returns null when the slug is not registered by any plugin. The catch-all
 * route already filters out unknown / disabled plugin slugs server-side via
 * notFound(), so this branch should be unreachable in production.
 */
export function PluginPageHandler({ slug, initialData }: PluginPageHandlerProps) {
    const pageConfig = useMemo(() => pluginRegistry.getPageByPath(slug), [slug]);
    const context = useMemo(() => {
        if (!pageConfig?.pluginId) {
            return null;
        }
        return createPluginContext(pageConfig.pluginId);
    }, [pageConfig?.pluginId]);

    if (!pageConfig || !context) {
        return null;
    }

    const PageComponent = pageConfig.component;
    return <PageComponent context={context} initialData={initialData} />;
}
