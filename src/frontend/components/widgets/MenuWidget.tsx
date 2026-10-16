'use client';

/**
 * @fileoverview Core "menu" widget renderer.
 *
 * Renders the menu widget type (id `core:main-menu`): the navigation from
 * whichever menu namespace the operator chose in the placement settings,
 * such as `main` or `footer`. The `main` menu used to be fixed in the site
 * header; as a widget an operator places any menu from `/system/widgets`.
 *
 * The menu's items do not come from the widget's `data`. Widget data is
 * cached per route and shared by every visitor, but a menu tree is filtered
 * per visitor (admins see the System container in `main`), so the root
 * layout fetches each visitor's tree for every namespace placed on the page
 * and provides them through `MenuSeedProvider`. The widget's own `data`
 * carries only the namespace and the operator's alignment choice.
 *
 * SSR + Live Updates: the seed is present during server rendering, so the
 * menu renders with the visitor's real items and the first client render
 * matches. `MenuNavClient` copies the seed into Redux on mount, and
 * `menu:update` refetches keep it current from then on.
 *
 * Item labels are translated by `MenuNavClient`, so a menu on a translated
 * page shows the labels saved on `/system/localization`.
 *
 * @module frontend/components/widgets/MenuWidget
 */

import { useEffect, type CSSProperties } from 'react';
import type { IWidgetComponentProps } from '@/types';
// Imported from the file rather than the MenuNav barrel, which also exports
// the server-only MenuNavSSR and would pull `next/headers` into this client file.
import { MenuNavClient } from '../layout/MenuNav/MenuNavClient';
import { refetchMenuTree, useMenuSeed } from '../../modules/menu';
import type { IMenuSeed } from '../../modules/menu/types';
import { useAppDispatch, useAppSelector } from '../../store/hooks';
// Imported from the hook file rather than the localization barrel, which also
// exports components with stylesheets.
import { useTranslation } from '../../modules/localization/hooks/useTranslation';
import styles from './MenuWidget.module.scss';

/** Namespace rendered when the payload names none, matching the backend fetcher's default. */
const DEFAULT_MENU_NAMESPACE = 'main';

/**
 * Seed used when the root layout did not fetch this namespace. Module-level
 * so its identity is stable across renders.
 */
const EMPTY_SEED: IMenuSeed = { roots: [], generatedAt: new Date(0).toISOString() };

/**
 * SSR payload shape produced by the menu widget's data fetcher. Mirrors
 * `IMenuWidgetData` in `backend/modules/widgets/widget-types/
 * core-widget-types.ts`; redeclared because the frontend cannot import
 * backend module internals.
 */
interface IMenuWidgetData {
    /** The menu namespace to render. */
    namespace?: string;
    /** Where the items sit within the width the placement is given. */
    align?: 'flex-start' | 'center' | 'flex-end';
}

/**
 * Menu widget: navigation for one namespace, seeded with the visitor's own tree.
 *
 * @param props - Widget component props; only the SSR `data` is read.
 * @returns The navigation, aligned as the operator chose.
 */
export function MenuWidget({ data }: IWidgetComponentProps) {
    const { namespace = DEFAULT_MENU_NAMESPACE, align = 'flex-end' } = (data ?? {}) as IMenuWidgetData;
    const seed = useMenuSeed(namespace);
    const { roots, generatedAt } = seed ?? EMPTY_SEED;
    const dispatch = useAppDispatch();
    const { t } = useTranslation();
    const loadedInRedux = useAppSelector(state => state.menu.namespaces[namespace]?.lastUpdated !== undefined);

    /**
     * Fetch the tree in the browser when the root layout did not seed it.
     *
     * The root layout seeds every namespace placed on the page it rendered,
     * but Next.js does not render the root layout again on a client-side
     * navigation. A menu placed only on the page navigated to therefore has
     * no seed, and would otherwise stay empty until the next `menu:update`.
     * The check uses the values from the render that scheduled the effect,
     * so the empty tree `MenuNavClient` writes to Redux on mount does not
     * count as loaded; once the fetched tree arrives, a re-run does nothing.
     */
    useEffect(() => {
        if (seed === null && !loadedInRedux) {
            void dispatch(refetchMenuTree({ namespace, timestamp: new Date().toISOString() }));
        }
    }, [seed, loadedInRedux, namespace, dispatch]);

    // The alignment is operator-chosen, so it rides as a custom property the
    // stylesheet reads rather than as a class per value.
    const alignStyle = { '--menu-widget-justify': align } as CSSProperties;

    return (
        <div className={styles.menu} style={alignStyle}>
            <MenuNavClient
                namespace={namespace}
                items={roots}
                generatedAt={generatedAt}
                ariaLabel={namespace === DEFAULT_MENU_NAMESPACE ? t('menu.widget.mainNavigation', 'Main navigation') : undefined}
            />
        </div>
    );
}
