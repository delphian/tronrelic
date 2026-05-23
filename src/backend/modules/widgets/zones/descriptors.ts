/**
 * @fileoverview Central declared-zone registry.
 *
 * This file is the single source of truth for every widget zone the
 * platform ships out of the box. Adding a new zone requires editing
 * this file and adding a corresponding `<WidgetZone>` call site in a
 * layout — descriptors and render sites must move together so the
 * registry stays honest about what zones actually exist on the page.
 *
 * Plugins declare additional zones through `context.zones.register(...)`
 * rather than editing this file. Their zones are runtime-only and
 * scoped to the plugin's lifecycle.
 *
 * Style:
 *
 * - Group keys by host (`site` / `core` / `plugin`).
 * - Use camelCase keys.
 * - Ids match the strings layouts pass to `<WidgetZone>` exactly.
 *
 * @see {@link ../../../../docs/plugins/plugins-widget-zones.md} for the
 *   conceptual contract: zone hosts, placement model, and SSR resolution.
 * @module backend/modules/widgets/zones/descriptors
 */

import { defineZone } from './define-zone.js';

/**
 * Declared core zones, organised by host. Core modules and layout files
 * import this object directly to reference zones by typed identifier
 * instead of string literal. Plugins reach the same runtime descriptors
 * through `context.zones` — they reference core zones by id from widget
 * placement records rather than by importing this object.
 */
export const ZONES = {
    /**
     * Rendered by the root layout (`src/frontend/app/layout.tsx`) below
     * the block ticker and above the main page content. Reaches every
     * route the root layout serves, so widgets placed here appear on
     * core, plugin, and admin pages alike. Operators typically scope
     * placements with route filters to avoid showing ticker-adjacent
     * widgets in the admin surface.
     */
    tickerAfter: defineZone({
        id: 'ticker-after',
        label: 'Below the block ticker',
        description:
            'Rendered in the root layout below the block ticker. Reaches every route the root layout serves.',
        host: 'site',
        layout: 'vertical'
    }),

    /**
     * Rendered above the page content inside the `(core)` route-group
     * layout — front-of-house pages only (`/`, `/u/[address]`, etc.).
     * Useful for banners and alerts that should appear on consumer
     * pages without leaking into plugin pages or the admin surface.
     */
    mainBefore: defineZone({
        id: 'main-before',
        label: 'Above main content',
        description:
            'Above the primary page content inside the (core) route group. Front-of-house pages only.',
        host: 'core',
        layout: 'vertical'
    }),

    /**
     * Rendered below the page content inside the `(core)` route-group
     * layout. Common destination for feeds, summaries, and related-
     * content widgets on front-of-house pages.
     */
    mainAfter: defineZone({
        id: 'main-after',
        label: 'Below main content',
        description:
            'Below the primary page content inside the (core) route group. Common destination for feeds and related-content widgets.',
        host: 'core',
        layout: 'vertical'
    }),

    /**
     * Rendered above an individual plugin page by the
     * `PluginPageWithZones` wrapper. Enables cross-plugin injection
     * around a plugin's own page without modifying that plugin.
     */
    pluginContentBefore: defineZone({
        id: 'plugin-content:before',
        label: 'Plugin page — before',
        description:
            'Above the rendered plugin page. Enables cross-plugin injection around plugin pages.',
        host: 'plugin',
        layout: 'vertical'
    }),

    /**
     * Rendered below an individual plugin page by the
     * `PluginPageWithZones` wrapper.
     */
    pluginContentAfter: defineZone({
        id: 'plugin-content:after',
        label: 'Plugin page — after',
        description:
            'Below the rendered plugin page. Enables cross-plugin injection around plugin pages.',
        host: 'plugin',
        layout: 'vertical'
    })
} as const;

/**
 * Type alias re-exported for ergonomic imports at core call sites that
 * want the full shape of the declared zone catalog.
 */
export type Zones = typeof ZONES;
