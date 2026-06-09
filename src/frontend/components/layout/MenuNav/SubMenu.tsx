/**
 * @fileoverview SubMenu — plugin-facing wrapper over MenuNavClient.
 *
 * Exposes the menu-service-backed navigation row to plugins as an in-page tab
 * strip. Plugins cannot import core components across the workspace boundary,
 * so this thin wrapper is published on `IFrontendPluginContext.layout` (see
 * `lib/frontendPluginContext.tsx`) and consumed as `context.layout.SubMenu`.
 *
 * It delegates all rendering to `MenuNavClient` — inheriting Priority+ overflow,
 * per-namespace config, gating-filtered items, and live `menu:update` refresh —
 * and only adapts the surface for the submenu use case: a friendlier
 * `onSelect(item)` callback (mapped to MenuNavClient's `onItemSelect`) and a
 * defaulted `generatedAt` so callers pass just the namespace, items, and active
 * url. When `onSelect` is omitted the row behaves as ordinary navigation links.
 *
 * The consumer is a client component (a plugin page already holds `activeTab`
 * state and receives its namespace tree via the plugin `serverDataFetcher`), so
 * there is no server/client function-boundary concern — the SSR-first data
 * arrives as a prop and this renders it immediately, no loading flash.
 *
 * @module components/layout/MenuNav/SubMenu
 */
'use client';

import type { ISubMenuItem } from '@/types';
import { MenuNavClient } from './MenuNavClient';

/**
 * Props for the SubMenu wrapper.
 */
export interface ISubMenuProps {
    /** Menu namespace whose tree backs this submenu (e.g. the plugin id). */
    namespace: string;

    /** Serialized menu nodes for the namespace, fetched SSR-first by the caller. */
    items: ISubMenuItem[];

    /**
     * Url of the active tab. Highlights the matching leaf instead of deriving
     * active state from the route, since tabs share one route.
     */
    activeUrl?: string;

    /**
     * Activation callback. When provided, leaf clicks call this and suppress
     * navigation, letting the page drive in-page tab state. Omitted leaves the
     * row as ordinary navigation links.
     */
    onSelect?: (item: ISubMenuItem) => void;

    /** Optional accessible label for the nav element. */
    ariaLabel?: string;

    /**
     * SSR snapshot timestamp seeded onto Redux. Optional for submenus — the
     * value is metadata only, so it defaults to an empty string when the caller
     * has no meaningful timestamp.
     */
    generatedAt?: string;
}

/**
 * Render a menu-service-backed in-page submenu (tab row) for a plugin.
 *
 * Delegates to MenuNavClient, mapping the friendlier `onSelect(item)` callback
 * onto MenuNavClient's `onItemSelect(item, event)` and defaulting `generatedAt`.
 *
 * @param props - SubMenu props
 * @returns The rendered submenu navigation row
 */
export function SubMenu({ namespace, items, activeUrl, onSelect, ariaLabel, generatedAt = '' }: ISubMenuProps): JSX.Element {
    return (
        <MenuNavClient
            namespace={namespace}
            items={items}
            generatedAt={generatedAt}
            ariaLabel={ariaLabel}
            activeUrl={activeUrl}
            onItemSelect={onSelect ? (item) => onSelect(item) : undefined}
        />
    );
}
