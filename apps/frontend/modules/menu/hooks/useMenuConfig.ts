/**
 * Hook for fetching and managing menu namespace configuration.
 *
 * Provides access to namespace-specific menu settings including Priority+
 * overflow behavior, icon display, layout orientation, and styling hints.
 * Configuration is fetched once on mount and cached for the component lifecycle.
 *
 * @example
 * ```tsx
 * function MyMenu() {
 *     const config = useMenuConfig('main');
 *
 *     if (config.loading) {
 *         return <div>Loading menu...</div>;
 *     }
 *
 *     return (
 *         <PriorityNav
 *             enabled={config.overflow?.enabled ?? true}
 *             collapseAtCount={config.overflow?.collapseAtCount}
 *         >
 *             {menuItems}
 *         </PriorityNav>
 *     );
 * }
 * ```
 */
'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '../../../lib/api';
import type { IMenuNamespaceConfig, IUseMenuConfigResult } from '../types';

/**
 * Default configuration used when API hasn't responded yet.
 *
 * Provides sensible defaults matching backend behavior (see MenuService.getNamespaceConfig).
 * Priority+ overflow enabled by default, icons enabled on left, horizontal layout.
 */
const DEFAULT_CONFIG: IMenuNamespaceConfig = {
    namespace: 'main',
    overflow: {
        enabled: true
    },
    icons: {
        enabled: true,
        position: 'left'
    },
    layout: {
        orientation: 'horizontal'
    }
};

/**
 * Fetches and manages menu namespace configuration from the backend.
 *
 * Makes a GET request to /api/menu/namespace/{namespace}/config on mount and
 * caches the result. If the request fails, falls back to default configuration.
 * The hook automatically handles loading states and provides type-safe access
 * to all configuration fields.
 *
 * @param namespace - Menu namespace to fetch config for (defaults to 'main')
 * @returns Configuration object with loading state
 */
export function useMenuConfig(namespace: string = 'main'): IUseMenuConfigResult {
    const [config, setConfig] = useState<IMenuNamespaceConfig>({
        ...DEFAULT_CONFIG,
        namespace
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        /**
         * Validates that the config object has required structure.
         *
         * @param config - Configuration object to validate
         * @throws Error if required fields are missing or invalid
         */
        function validateConfig(config: unknown): asserts config is IMenuNamespaceConfig {
            if (!config || typeof config !== 'object') {
                throw new Error('Config must be an object');
            }

            const c = config as Partial<IMenuNamespaceConfig>;

            if (!c.namespace) {
                throw new Error('Config missing required field: namespace');
            }

            // Validate optional overflow field structure if present
            if (c.overflow !== undefined) {
                if (typeof c.overflow !== 'object' || c.overflow === null) {
                    throw new Error('Config overflow must be an object');
                }
                if (typeof c.overflow.enabled !== 'boolean') {
                    throw new Error('Config overflow.enabled must be a boolean');
                }
                if (c.overflow.collapseAtCount !== undefined && typeof c.overflow.collapseAtCount !== 'number') {
                    throw new Error('Config overflow.collapseAtCount must be a number');
                }
            }
        }

        /**
         * Fetches namespace configuration from backend API.
         */
        async function fetchConfig() {
            try {
                const response = await apiClient.get<{ success: boolean; config: IMenuNamespaceConfig }>(
                    `/menu/namespace/${namespace}/config`
                );

                if (!response.data || !response.data.config) {
                    throw new Error('Invalid API response structure: missing config property');
                }

                validateConfig(response.data.config);
                setConfig(response.data.config);
            } catch (error) {
                console.error(`Failed to fetch menu config for namespace '${namespace}':`, error);
                // Keep default config on error
            } finally {
                setLoading(false);
            }
        }

        void fetchConfig();
    }, [namespace]);

    return {
        ...config,
        loading
    };
}
