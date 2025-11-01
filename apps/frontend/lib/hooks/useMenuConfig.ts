/**
 * Hook for fetching and managing menu namespace configuration.
 *
 * Provides access to namespace-specific menu settings including hamburger menu
 * behavior, icon display, layout orientation, and styling hints. Configuration
 * is fetched once on mount and cached for the component lifecycle.
 *
 * The hook handles loading states and provides sensible defaults when configuration
 * hasn't loaded yet or if the API request fails.
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
 *         <nav style={{ containerType: 'inline-size' }}>
 *             {config.hamburgerMenu?.enabled && (
 *                 <HamburgerButton triggerWidth={config.hamburgerMenu.triggerWidth} />
 *             )}
 *         </nav>
 *     );
 * }
 * ```
 */
'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '../api';

/**
 * Menu namespace configuration structure.
 *
 * Matches IMenuNamespaceConfig from backend types. Contains UI rendering
 * preferences that control how a menu namespace is displayed.
 */
export interface IMenuNamespaceConfig {
    /**
     * Database-assigned unique identifier (undefined when using defaults).
     */
    _id?: string;

    /**
     * Menu namespace this configuration applies to (e.g., 'main', 'system').
     */
    namespace: string;

    /**
     * Hamburger menu (collapsed mobile navigation) settings.
     */
    hamburgerMenu?: {
        /**
         * Whether hamburger menu is enabled for this namespace.
         */
        enabled: boolean;

        /**
         * Container width in pixels that triggers hamburger mode.
         * Uses container queries (@container), not media queries (@media).
         */
        triggerWidth: number;
    };

    /**
     * Icon display settings for menu items.
     */
    icons?: {
        /**
         * Whether icons are displayed.
         */
        enabled: boolean;

        /**
         * Position of icon relative to label text.
         */
        position?: 'left' | 'right' | 'top';
    };

    /**
     * Layout and structural settings.
     */
    layout?: {
        /**
         * Direction menu items flow.
         */
        orientation: 'horizontal' | 'vertical';

        /**
         * Maximum number of items before overflow.
         */
        maxItems?: number;
    };

    /**
     * Visual styling hints (optional).
     */
    styling?: {
        /**
         * Use compact spacing and smaller text.
         */
        compact?: boolean;

        /**
         * Whether to show text labels (icon-only mode when false).
         */
        showLabels?: boolean;
    };

    /**
     * Timestamp when configuration was created.
     */
    createdAt?: Date;

    /**
     * Timestamp when configuration was last updated.
     */
    updatedAt?: Date;
}

/**
 * Hook return value with configuration and loading state.
 */
interface IUseMenuConfigResult extends IMenuNamespaceConfig {
    /**
     * Whether the configuration is currently being fetched.
     * True during initial load, false once data arrives or fails.
     */
    loading: boolean;
}

/**
 * Default configuration used when API hasn't responded yet.
 *
 * Provides sensible defaults matching backend behavior (see MenuService.getNamespaceConfig).
 * Hamburger menu enabled at 768px, icons enabled on left, horizontal layout.
 */
const DEFAULT_CONFIG: IMenuNamespaceConfig = {
    namespace: 'main',
    hamburgerMenu: {
        enabled: true,
        triggerWidth: 768
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
 * Configuration changes require a component remount to reflect (no real-time
 * updates via WebSocket yet). For real-time updates, subscribe to the menu
 * configuration WebSocket event separately.
 *
 * @param namespace - Menu namespace to fetch config for (defaults to 'main')
 * @returns Configuration object with loading state
 *
 * @example
 * ```tsx
 * // Basic usage with default namespace
 * const config = useMenuConfig();
 *
 * // Specific namespace
 * const systemConfig = useMenuConfig('system');
 * const footerConfig = useMenuConfig('footer');
 *
 * // Check hamburger settings
 * if (config.hamburgerMenu?.enabled) {
 *     console.log('Hamburger triggers at:', config.hamburgerMenu.triggerWidth, 'px');
 * }
 * ```
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
         * Checks for presence of required configuration fields to detect
         * malformed responses or API changes early. Throws descriptive error
         * if validation fails.
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

            if (!c.hamburgerMenu || typeof c.hamburgerMenu !== 'object') {
                throw new Error('Config missing required field: hamburgerMenu');
            }

            if (typeof c.hamburgerMenu.enabled !== 'boolean') {
                throw new Error('Config hamburgerMenu.enabled must be a boolean');
            }

            if (typeof c.hamburgerMenu.triggerWidth !== 'number') {
                throw new Error('Config hamburgerMenu.triggerWidth must be a number');
            }
        }

        /**
         * Fetches namespace configuration from backend API.
         *
         * On success, validates and updates state with fetched config. On failure,
         * keeps default configuration and logs error. Always sets loading to false
         * when complete (success or failure).
         */
        async function fetchConfig() {
            try {
                const response = await apiClient.get<{ success: boolean; config: IMenuNamespaceConfig }>(
                    `/menu/namespace/${namespace}/config`
                );

                // Validate response structure
                if (!response.data || !response.data.config) {
                    throw new Error('Invalid API response structure: missing config property');
                }

                // Validate config has required fields
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
