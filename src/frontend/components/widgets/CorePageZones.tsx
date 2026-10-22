/**
 * @fileoverview Wraps a front-of-house page in the `main-before` and
 * `main-after` widget zones.
 *
 * Core pages reach the browser through two routes: the `(core)` route group,
 * whose layout wraps every page it serves, and the catch-all route, which
 * builds menu category landing pages and markdown pages from the pages module
 * itself. A widget placed in one of these zones has to render on both, or an
 * operator who places it on a page such as `/tools` sees it do nothing. This
 * component is the single place both routes get the zones from.
 *
 * @module frontend/components/widgets/CorePageZones
 */

import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { WidgetZone } from './WidgetZone';
import { fetchWidgetsForRoute } from './fetchWidgetsForRoute';

/** Props for {@link CorePageZones}. */
interface ICorePageZonesProps {
    /** The page content the two zones sit above and below. */
    children: ReactNode;
}

/**
 * Render the page content between the `main-before` and `main-after` zones.
 *
 * Widgets are matched against the path the middleware stores in the
 * `x-pathname` request header. For a translated page that path has the
 * language prefix removed, so a widget placed on `/tools` also renders on
 * `/zh/tools`. The header carries no matched-route params, so every widget
 * here receives an empty param map; a page whose widgets need route params
 * must fetch its own bundle and render its own zones.
 *
 * @param props - The page content to wrap.
 * @returns The content with both zones rendered around it during SSR.
 */
export async function CorePageZones({ children }: ICorePageZonesProps) {
    const headersList = await headers();
    const pathname = headersList.get('x-pathname') || '/';
    const params: Record<string, string> = {};

    const { widgets, zones } = await fetchWidgetsForRoute(pathname, params);

    return (
        <div className="core-layout">
            <WidgetZone name="main-before" widgets={widgets} layout={zones['main-before']} route={pathname} params={params} />
            {children}
            <WidgetZone name="main-after" widgets={widgets} layout={zones['main-after']} route={pathname} params={params} />
        </div>
    );
}
