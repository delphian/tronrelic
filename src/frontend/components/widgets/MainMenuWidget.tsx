'use client';

/**
 * @fileoverview Core "main menu" widget renderer.
 *
 * Renders the `core:main-menu` widget type: the site navigation from the
 * `main` menu namespace. It used to be fixed in the site header; as a widget
 * an operator places it from `/system/widgets`.
 *
 * The menu's items do not come from the widget's `data`. Widget data is
 * cached per route and shared by every visitor, but the `main` tree is
 * filtered per visitor (admins see the System container), so the root layout
 * fetches each visitor's tree on every request and provides it through
 * `MenuSeedProvider`. The widget's own `data` carries only the operator's
 * alignment choice.
 *
 * SSR + Live Updates: the seed is present during server rendering, so the
 * menu renders with the visitor's real items and the first client render
 * matches. `MenuNavClient` copies the seed into Redux on mount, and
 * `menu:update` refetches keep it current from then on.
 *
 * @module frontend/components/widgets/MainMenuWidget
 */

import type { CSSProperties } from 'react';
import type { IWidgetComponentProps } from '@/types';
// Imported from the file rather than the MenuNav barrel, which also exports
// the server-only MenuNavSSR and would pull `next/headers` into this client file.
import { MenuNavClient } from '../layout/MenuNav/MenuNavClient';
import { useMenuSeed } from '../../modules/menu';
import styles from './MainMenuWidget.module.scss';

/** The menu namespace this widget renders; the root layout seeds exactly this one. */
const MAIN_MENU_NAMESPACE = 'main';

/**
 * SSR payload shape produced by the `core:main-menu` data fetcher. Mirrors
 * `IMainMenuWidgetData` in `backend/modules/widgets/widget-types/
 * core-widget-types.ts`; redeclared because the frontend cannot import
 * backend module internals.
 */
interface IMainMenuData {
    /** Where the items sit within the width the placement is given. */
    align?: 'flex-start' | 'center' | 'flex-end';
}

/**
 * Main menu widget: the site navigation, seeded with the visitor's own tree.
 *
 * @param props - Widget component props; only the SSR `data` is read.
 * @returns The navigation, aligned as the operator chose.
 */
export function MainMenuWidget({ data }: IWidgetComponentProps) {
    const { align = 'flex-end' } = (data ?? {}) as IMainMenuData;
    const { roots, generatedAt } = useMenuSeed(MAIN_MENU_NAMESPACE);

    // The alignment is operator-chosen, so it rides as a custom property the
    // stylesheet reads rather than as a class per value.
    const alignStyle = { '--main-menu-justify': align } as CSSProperties;

    return (
        <div className={styles.menu} style={alignStyle}>
            <MenuNavClient
                namespace={MAIN_MENU_NAMESPACE}
                items={roots}
                generatedAt={generatedAt}
                ariaLabel="Main navigation"
            />
        </div>
    );
}
