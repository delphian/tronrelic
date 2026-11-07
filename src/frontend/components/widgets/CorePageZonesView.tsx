'use client';

/**
 * @fileoverview Draws the `main-before` and `main-after` zones around a core
 * page, from a bundle that follows the visitor between pages.
 *
 * `CorePageZones` fetches the bundle on the server and hands it here. This
 * client component renders it and, through `useRouteWidgets`, swaps in the
 * bundle for the new page after an in-page navigation, which a layout cannot
 * do on its own because Next.js does not render it again.
 *
 * @module frontend/components/widgets/CorePageZonesView
 */

import type { ReactNode } from 'react';
import { WidgetZone } from './WidgetZone';
import { useRouteWidgets, type IRouteWidgetBundle } from './useRouteWidgets';

/** Props for {@link CorePageZonesView}. */
interface ICorePageZonesViewProps {
    /** The bundle the server resolved for the page it rendered, with that page's path. */
    initial: IRouteWidgetBundle;

    /** The page content the two zones sit above and below. */
    children: ReactNode;
}

/**
 * Render the page content between the two core zones, using the bundle for
 * the page currently shown.
 *
 * @param props - The server bundle and the page content.
 * @returns The content with both zones around it.
 */
export function CorePageZonesView({ initial, children }: ICorePageZonesViewProps) {
    const { route, widgets, zones } = useRouteWidgets(initial);
    return (
        <div className="core-layout">
            <WidgetZone name="main-before" widgets={widgets} layout={zones['main-before']} route={route} params={{}} />
            {children}
            <WidgetZone name="main-after" widgets={widgets} layout={zones['main-after']} route={route} params={{}} />
        </div>
    );
}
