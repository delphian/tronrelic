/**
 * @fileoverview Core widget-zone descriptors as plain data.
 *
 * Single source of truth for every zone the platform ships out of the
 * box. `WidgetsModule.run()` iterates this array and calls
 * `widgetsService.registerZone(descriptor, 'core')` for each, so the
 * registry is populated through the same code path plugins use — no
 * static-minting shortcut, no parallel admission flow.
 *
 * Adding a new zone requires editing this file *and* adding a
 * matching `<WidgetZone>` call site in a layout — descriptors and
 * render sites must move together so the registry stays honest about
 * what zones actually exist on the page.
 *
 * @see {@link ../../../../docs/plugins/plugins-widget-zones.md} for the
 *   conceptual contract.
 * @module backend/modules/widgets/zones/descriptors
 */

import type { IRegisterZoneInput } from '@/types';

/**
 * Declared core zones. Bundle of plain input objects — minting
 * happens inside `WidgetsService.registerZone` when
 * `WidgetsModule.run()` iterates this list at bootstrap.
 */
export const CORE_ZONE_DESCRIPTORS: ReadonlyArray<IRegisterZoneInput> = [
    {
        id: 'ticker-after',
        label: 'Site Header',
        description:
            'Rendered in the root layout directly below the main navigation, across every route the root layout serves. Home for the block ticker and other site-wide header widgets. (Zone id stays "ticker-after" so existing placements survive the rename.)',
        host: 'site',
        layout: 'vertical',
        order: 10
    },
    {
        id: 'footer',
        label: 'Site footer',
        description:
            'Rendered in the root layout below the main content, inside a semantic <footer>. Reaches every route the root layout serves — the home for site-wide footer content (links, legal text, attribution).',
        host: 'site',
        layout: 'vertical',
        order: 90
    },
    {
        id: 'main-before',
        label: 'Above main content',
        description:
            'Above the primary page content inside the (core) route group. Front-of-house pages only.',
        host: 'core',
        layout: 'vertical',
        order: 10
    },
    {
        id: 'main-after',
        label: 'Below main content',
        description:
            'Below the primary page content inside the (core) route group. Common destination for feeds and related-content widgets.',
        host: 'core',
        layout: 'vertical',
        order: 20
    },
    {
        id: 'plugin-content:before',
        label: 'Plugin page — before',
        description:
            'Above the rendered plugin page. Enables cross-plugin injection around plugin pages.',
        host: 'plugin',
        layout: 'vertical',
        order: 10
    },
    {
        id: 'plugin-content:after',
        label: 'Plugin page — after',
        description:
            'Below the rendered plugin page. Enables cross-plugin injection around plugin pages.',
        host: 'plugin',
        layout: 'vertical',
        order: 20
    }
] as const;
