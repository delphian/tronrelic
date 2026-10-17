'use client';

/**
 * @fileoverview Core "tab bar" widget renderer.
 *
 * Renders the `core:tab-bar` widget type, normally placed in the Mobile tab
 * bar zone, which fixes it to the bottom of the screen on phones. The
 * widget's `data` carries only namespace names and display settings; the menu
 * items come from the per-visitor trees the root layout seeds, for the same
 * reason as the menu widget: widget data is shared by every visitor, while a
 * menu tree is filtered per visitor.
 *
 * @module frontend/components/widgets/TabBarWidget
 */

import type { IWidgetComponentProps } from '@/types';
import { TabBar } from '../../modules/menu';

/** Namespace used when the payload names none, matching the backend fetcher's default. */
const DEFAULT_MENU_NAMESPACE = 'main';

/** Link tabs shown when the payload sets none, matching the backend fetcher's default. */
const DEFAULT_MAX_TABS = 4;

/**
 * SSR payload shape produced by the `core:tab-bar` data fetcher. Mirrors
 * `ITabBarWidgetData` in `backend/modules/widgets/widget-types/
 * core-widget-types.ts`; redeclared because the frontend cannot import
 * backend module internals.
 */
interface ITabBarWidgetData {
    /** The menu namespace whose first items become the tabs. */
    namespace?: string;
    /** How many link tabs to show. */
    maxTabs?: number;
    /** Whether a final Menu tab opens the full menu. */
    menuTab?: boolean;
    /** The menu namespace the Menu tab's panel lists. */
    panelNamespace?: string;
    /** Whether the panel ends with the language switcher. */
    languageSwitcher?: boolean;
}

/**
 * Tab bar widget: the payload's settings passed to the menu module's `TabBar`.
 *
 * @param props - Widget component props; only the SSR `data` is read.
 * @returns The tab bar.
 */
export function TabBarWidget({ data }: IWidgetComponentProps) {
    const {
        namespace = DEFAULT_MENU_NAMESPACE,
        maxTabs = DEFAULT_MAX_TABS,
        menuTab = true,
        panelNamespace = DEFAULT_MENU_NAMESPACE,
        languageSwitcher = true
    } = (data ?? {}) as ITabBarWidgetData;

    return (
        <TabBar
            namespace={namespace}
            maxTabs={maxTabs}
            menuTab={menuTab}
            panelNamespace={panelNamespace}
            languageSwitcher={languageSwitcher}
        />
    );
}
