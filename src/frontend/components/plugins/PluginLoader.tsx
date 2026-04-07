'use client';

import { useEffect, useState } from 'react';
import type { IPluginManifest } from '@/types';
import { pluginRegistry } from '../../lib/pluginRegistry';
import { createPluginContext } from '../../lib/frontendPluginContext';
import { getRuntimeConfig } from '../../lib/runtimeConfig';

/**
 * Plugin Loader component.
 *
 * The plugin registry is now self-bootstrapping at module load (see
 * pluginRegistry.ts), so this component no longer fetches manifests to
 * dynamically import plugin frontend modules — every built-in plugin is
 * already in the registry by the time this component mounts.
 *
 * Its remaining responsibility is to render the global side-effect components
 * that some plugins ship (e.g., AiAssistantToastHandler, WhaleAlertsToastHandler)
 * — but only for plugins that are currently enabled. To honor enabled state, it
 * fetches /api/plugins/manifests once on mount and intersects the result with
 * the registry's full plugin list.
 *
 * If a plugin is disabled, its side-effect component never mounts, preserving
 * the runtime-disable behavior the admin UI promises.
 */
export function PluginLoader() {
    const [enabledIds, setEnabledIds] = useState<Set<string> | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadEnabledManifests() {
            try {
                // Use the SSR-injected runtime config (lib/runtimeConfig) instead
                // of the deprecated lib/config build-time module, so the URL is
                // correct in universal Docker images regardless of build-time env.
                const { apiUrl } = getRuntimeConfig();
                const response = await fetch(`${apiUrl}/plugins/manifests`);
                const data = await response.json();
                const manifests: IPluginManifest[] = data.manifests ?? [];
                if (!cancelled) {
                    setEnabledIds(new Set(manifests.map(m => m.id)));
                }
            } catch (error) {
                console.error('Failed to load plugin manifests:', error);
                if (!cancelled) {
                    setEnabledIds(new Set());
                }
            }
        }

        void loadEnabledManifests();

        return () => {
            cancelled = true;
        };
    }, []);

    // Until the manifest fetch resolves, render no side-effect components.
    // The registry is already populated, but we don't yet know which plugins
    // are enabled — rendering all of them would let disabled plugins run.
    if (!enabledIds) {
        return null;
    }

    const pluginsWithComponents = pluginRegistry
        .getAllPlugins()
        .filter(plugin => plugin.component && enabledIds.has(plugin.manifest.id));

    return (
        <>
            {pluginsWithComponents.map(plugin => {
                const Component = plugin.component!;
                const context = createPluginContext(plugin.manifest.id);
                return <Component key={plugin.manifest.id} context={context} />;
            })}
        </>
    );
}
