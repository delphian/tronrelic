'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState, useMemo } from 'react';
import { pluginRegistry } from '../../../lib/pluginRegistry';
import { createPluginContext } from '../../../lib/frontendPluginContext';
import type { IPageConfig } from '@tronrelic/types';

/**
 * Dynamic plugin page route handler.
 *
 * This catch-all route renders plugin pages based on the URL path. It looks up
 * the appropriate page configuration from the plugin registry and renders the
 * associated React component with a plugin-specific context for automatic
 * event namespacing. This enables plugins to own their routes without
 * modifying core routing infrastructure.
 */
export default function PluginPage() {
    const params = useParams();
    const [pageConfig, setPageConfig] = useState<IPageConfig | null>(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
        // Construct the full path from the dynamic segments
        const segments = Array.isArray(params.plugin) ? params.plugin : [params.plugin];
        const path = `/${segments.join('/')}`;

        let attempts = 0;
        const maxAttempts = 50; // 5 seconds max (50 * 100ms)

        // Poll for plugin registration with retry logic
        const checkForPlugin = () => {
            const config = pluginRegistry.getPageByPath(path);

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
    }, [params]);

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
                        The plugin page you're looking for doesn't exist.
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
                    <p className="mt-4 text-muted-foreground">Loading plugin page...</p>
                </div>
            </div>
        );
    }

    const PageComponent = pageConfig.component;

    return <PageComponent context={context} />;
}
