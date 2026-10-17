'use client';

/**
 * @fileoverview Phone navigation fixed to the bottom of the screen.
 *
 * On a phone the header row has room for only a couple of menu links before
 * everything else folds into "More". A tab bar puts the site's main
 * destinations within reach of the thumb instead, as an icon above a short
 * label, and a final Menu tab opens the full menu plus the language switcher.
 *
 * The bar draws the first items of one menu namespace, so an operator chooses
 * the tabs at `/system/menu` rather than in code. Items are read through
 * `useMenuTree`, which starts from the server seed so the bar renders with the
 * visitor's real tabs during server rendering, then follows `menu:update`.
 * Where the bar sits on the page, and on which screens it shows, is decided by
 * the Mobile tab bar zone that holds it, not by this component.
 *
 * @module modules/menu/components/TabBar
 */

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu as MenuIcon } from 'lucide-react';
import type { MenuNodeSerialized } from '@/shared';
import { useMenuTree } from '../../hooks/useMenuTree';
import { menuTranslationKey } from '../../lib/menuTranslationKey';
import { isMenuPathActive } from '../../lib/isMenuPathActive';
// Imported from the hook files rather than the localization barrel, which also
// exports the admin tabs and their stylesheets.
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { useLocalizedHref } from '../../../localization/hooks/useLocalizedHref';
import { MenuNodeIcon } from '../../../../components/layout/MenuNav/MenuNodeIcon';
import { cn } from '../../../../lib/cn';
import { MenuPanel } from './MenuPanel';
import styles from './TabBar.module.scss';

/** Pixel size of each tab's icon, the 20px step of the icon scale. */
const TAB_ICON_SIZE = 20;

/**
 * Props for {@link TabBar}.
 */
export interface ITabBarProps {
    /** The menu namespace whose first items become the tabs. */
    namespace: string;
    /** How many link tabs to show, not counting the Menu tab. */
    maxTabs: number;
    /** Whether to add a final Menu tab that opens the full menu. */
    menuTab: boolean;
    /** The menu namespace the Menu tab's panel lists. */
    panelNamespace: string;
    /** Whether the panel ends with the language switcher. */
    languageSwitcher: boolean;
}

/**
 * Render the tab bar.
 *
 * @param props - The namespaces and display settings from the widget placement.
 * @returns A navigation landmark holding one tab per menu item, plus the Menu tab and its panel.
 */
export function TabBar({ namespace, maxTabs, menuTab, panelNamespace, languageSwitcher }: ITabBarProps) {
    const { roots } = useMenuTree(namespace);
    const pathname = usePathname() ?? '/';
    const { t } = useTranslation();
    const localizeHref = useLocalizedHref();
    const [panelOpen, setPanelOpen] = useState(false);

    // Only items that link somewhere can be a tab; a category with no page of
    // its own has nothing to open from a single tap.
    const tabs = useMemo(() => roots
        .filter((item: MenuNodeSerialized) => item.enabled && !!item.url)
        .sort((a, b) => a.order - b.order)
        .slice(0, maxTabs), [roots, maxTabs]);

    /**
     * Open the Menu tab's panel. A stable callback so the tab button does not
     * re-render on every bar render.
     */
    const openPanel = useCallback(() => setPanelOpen(true), []);

    /**
     * Close the panel. Stable because `SlideOver` lists it as an effect
     * dependency, and a new function each render would re-run that effect and
     * move focus back into the panel.
     */
    const closePanel = useCallback(() => setPanelOpen(false), []);

    const menuLabel = t('menu.tabBar.menu', 'Menu');

    return (
        <nav className={styles.bar} aria-label={t('menu.tabBar.ariaLabel', 'Primary')}>
            <ul className={styles.list}>
                {tabs.map(item => {
                    const href = localizeHref(item.url!);
                    const isActive = isMenuPathActive(pathname, href, item.url === '/');
                    return (
                        <li key={item._id} className={styles.item}>
                            <Link
                                href={href}
                                className={cn(styles.tab, isActive && styles.tab_active)}
                                aria-current={isActive ? 'page' : undefined}
                            >
                                {/* The slot keeps its size while the icon chunk loads
                                    after hydration, so the label does not jump. */}
                                <span className={styles.icon_slot} aria-hidden="true">
                                    {item.icon && <MenuNodeIcon name={item.icon} size={TAB_ICON_SIZE} />}
                                </span>
                                <span className={styles.label}>{t(menuTranslationKey(namespace, item), item.label)}</span>
                            </Link>
                        </li>
                    );
                })}
                {menuTab && (
                    <li className={styles.item}>
                        <button
                            type="button"
                            className={cn(styles.tab, panelOpen && styles.tab_active)}
                            aria-haspopup="dialog"
                            aria-expanded={panelOpen}
                            onClick={openPanel}
                        >
                            <span className={styles.icon_slot} aria-hidden="true">
                                <MenuIcon size={TAB_ICON_SIZE} />
                            </span>
                            <span className={styles.label}>{menuLabel}</span>
                        </button>
                    </li>
                )}
            </ul>
            {menuTab && (
                <MenuPanel
                    open={panelOpen}
                    onClose={closePanel}
                    title={menuLabel}
                    namespace={panelNamespace}
                    languageSwitcher={languageSwitcher}
                />
            )}
        </nav>
    );
}
