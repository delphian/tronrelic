'use client';

import { useEffect, useState } from 'react';
import type { IPlugin, IPluginManifest } from '@tronrelic/types';
import { frontendPluginLoaders } from './plugins.generated';
import { pluginRegistry } from '../../lib/pluginRegistry';
import { createPluginContext } from '../../lib/frontendPluginContext';
import { config } from '../../lib/config';

/**
 * Plugin Loader component.
 *
 * Fetches plugin manifests from the backend and lazily loads the matching frontend modules.
 * This keeps plugin registration automatic while letting Next.js compile the code directly.
 * Additionally, it registers plugins with the menu/page registry for dynamic navigation.
 *
 * Each plugin receives a plugin-specific context with automatic event namespacing,
 * ensuring WebSocket events are properly isolated between plugins.
 */
export function PluginLoader() {
    const [plugins, setPlugins] = useState<IPlugin[]>([]);

    useEffect(() => {
        let cancelled = false;

        async function loadPlugins() {
            try {
                const response = await fetch(`${config.apiBaseUrl}/plugins/manifests`);
                const data = await response.json();
                const manifests: IPluginManifest[] = data.manifests ?? [];

                const loadableManifests = manifests.filter(manifest => manifest.frontend);
                const pluginPromises = loadableManifests.map(async manifest => {
                    const loader = frontendPluginLoaders[manifest.id];

                    if (!loader) {
                        console.warn(`No registered frontend module for plugin '${manifest.id}'.`);
                        return null;
                    }

                    try {
                        return await loader();
                    } catch (error) {
                        console.error(`Failed to load frontend plugin ${manifest.id}:`, error);
                        return null;
                    }
                });

                const resolvedPlugins = (await Promise.all(pluginPromises)).filter(
                    (plugin): plugin is IPlugin => Boolean(plugin)
                );

                if (!cancelled) {
                    // Register plugins with the menu/page registry
                    pluginRegistry.clear(); // Clear previous registrations
                    resolvedPlugins.forEach(plugin => pluginRegistry.registerPlugin(plugin));

                    setPlugins(resolvedPlugins);
                }
            } catch (error) {
                console.error('Failed to load plugin manifests:', error);
            }
        }

        void loadPlugins();

        return () => {
            cancelled = true;
        };
    }, []);

    const pluginsWithComponents = plugins.filter(plugin => plugin.component);

    return (
        <>
            {pluginsWithComponents.map(plugin => {
                const Component = plugin.component!;
                // Create plugin-specific context with automatic event namespacing
                const context = createPluginContext(plugin.manifest.id);
                return <Component key={plugin.manifest.id} context={context} />;
            })}
        </>
    );
}
