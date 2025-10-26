'use client';

import { useEffect, useState, useMemo } from 'react';
import { pluginRegistry } from '../lib/pluginRegistry';
import { createPluginContext } from '../lib/frontendPluginContext';
import type { IPageConfig } from '@tronrelic/types';

/**
 * Plugin page handler component.
 *
 * This component checks the plugin registry for a registered page at the given
 * path and renders it with plugin-specific context. If no plugin page is found,
 * it displays a 404 message.
 *
 * This is used by the unified catch-all route to handle plugin pages after
 * checking that the path is not a custom user-created page.
 */
export function PluginPageHandler({ slug }: { slug: string }) {
    const [pageConfig, setPageConfig] = useState<IPageConfig | null>(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max (50 * 100ms)

        // Poll for plugin registration with retry logic
        const checkForPlugin = () => {
            const config = pluginRegistry.getPageByPath(slug);

            if (config) {
                setPageConfig(config);
            } else if (attempts < maxAttempts) {
                attempts++;
                setTimeout(checkForPlugin, 100);
            } else {
                setNotFound(true);
            }
        };

        // Start checking immediately
        checkForPlugin();
    }, [slug]);

    // Create plugin-specific context with automatic event namespacing
    const context = useMemo(() => {
        if (!pageConfig?.pluginId) {
            return createPluginContext('');
        }
        return createPluginContext(pageConfig.pluginId);
    }, [pageConfig?.pluginId]);

    if (notFound) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <h1 className="text-4xl font-bold mb-4">404 - Page Not Found</h1>
                    <p className="text-muted-foreground">
                        The page you're looking for doesn't exist.
                    </p>
                </div>
            </div>
        );
    }

    if (!pageConfig) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                    <p className="mt-4 text-muted-foreground">Loading page...</p>
                </div>
            </div>
        );
    }

    const PageComponent = pageConfig.component;

    return <PageComponent context={context} />;
}
