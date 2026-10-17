/**
 * @fileoverview Lists the menu namespaces the menu widgets on a page render.
 *
 * A menu widget's items are filtered per visitor, so they cannot travel in
 * the widget payload, which is cached per route and shared by every visitor.
 * The root layout fetches each visitor's tree itself instead, and it needs to
 * know which namespaces to fetch. Each menu placement names its namespace in
 * its widget data, and a tab bar names two (its tabs and its Menu panel), so
 * this walks the resolved widget bundle and collects them.
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

/** Widget-type id of the mobile tab bar. */
const TAB_BAR_WIDGET_TYPE_ID = 'core:tab-bar';

/** Namespace a menu placement renders when its data names none, matching the backend fetcher's default. */
const DEFAULT_MENU_NAMESPACE = 'main';

/**
 * Read one namespace field from a widget's data, falling back to `main` the
 * way the backend fetchers do when the field is missing.
 *
 * @param data - The widget's resolved data payload.
 * @param field - Which field holds the namespace, such as `namespace` or `panelNamespace`.
 * @returns The namespace to fetch for that field.
 */
function namespaceField(data: unknown, field: string): string {
    const value = (data as Record<string, unknown> | null)?.[field];
    return typeof value === 'string' && value !== '' ? value : DEFAULT_MENU_NAMESPACE;
}

/**
 * List the namespaces one widget renders, or none when it does not render a menu.
 *
 * @param widget - One resolved widget, top level or nested.
 * @returns The namespaces whose trees this widget needs. A tab bar with its
 *   Menu tab switched off needs only its tab namespace.
 */
function namespacesOf(widget: IWidgetData): string[] {
    let namespaces: string[] = [];
    if (widget.id === MENU_WIDGET_TYPE_ID) {
        namespaces = [namespaceField(widget.data, 'namespace')];
    } else if (widget.id === TAB_BAR_WIDGET_TYPE_ID) {
        const menuTab = (widget.data as { menuTab?: unknown } | null)?.menuTab !== false;
        namespaces = menuTab
            ? [namespaceField(widget.data, 'namespace'), namespaceField(widget.data, 'panelNamespace')]
            : [namespaceField(widget.data, 'namespace')];
    }
    return namespaces;
}

/**
 * Collect the distinct menu namespaces rendered by the menu and tab-bar
 * widgets in a resolved widget bundle, including widgets nested in a layout
 * group.
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
        namespacesOf(widget).forEach(namespace => namespaces.add(namespace));
        pending.push(...(widget.children ?? []));
    }

    return Array.from(namespaces);
}
