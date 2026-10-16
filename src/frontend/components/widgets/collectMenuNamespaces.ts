/**
 * @fileoverview Lists the menu namespaces the menu widgets on a page render.
 *
 * A menu widget's items are filtered per visitor, so they cannot travel in
 * the widget payload, which is cached per route and shared by every visitor.
 * The root layout fetches each visitor's tree itself instead, and it needs to
 * know which namespaces to fetch. Each menu placement names its namespace in
 * its widget data, so this walks the resolved widget bundle and collects them.
 *
 * @module frontend/components/widgets/collectMenuNamespaces
 */

import type { IWidgetData } from '@/types';

/**
 * Widget-type id of the menu widget. It still reads `main-menu` because the
 * widget once rendered only the `main` namespace, and the id is stored on
 * every existing placement.
 */
const MENU_WIDGET_TYPE_ID = 'core:main-menu';

/** Namespace a menu placement renders when its data names none, matching the backend fetcher's default. */
const DEFAULT_MENU_NAMESPACE = 'main';

/**
 * Collect the distinct menu namespaces rendered by the menu widgets in a
 * resolved widget bundle, including widgets nested in a layout group.
 *
 * @param widgets - The widgets resolved for the current route, top level
 *   first, with layout-group children under `children`.
 * @returns Each namespace once, in the order first seen, so the caller
 *   fetches every tree a menu on the page needs and none it does not.
 */
export function collectMenuNamespaces(widgets: readonly IWidgetData[]): string[] {
    const namespaces = new Set<string>();
    const pending: IWidgetData[] = [...widgets];

    while (pending.length > 0) {
        const widget = pending.shift()!;
        if (widget.id === MENU_WIDGET_TYPE_ID) {
            const namespace = (widget.data as { namespace?: unknown } | null)?.namespace;
            namespaces.add(typeof namespace === 'string' && namespace !== '' ? namespace : DEFAULT_MENU_NAMESPACE);
        }
        pending.push(...(widget.children ?? []));
    }

    return Array.from(namespaces);
}
