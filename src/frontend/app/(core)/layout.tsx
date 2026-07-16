import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { WidgetZone, fetchWidgetsForRoute } from '../../components/widgets';

/**
 * Core layout with widget zone support.
 *
 * Fetches widgets for the current route during SSR and renders them in
 * designated zones. This allows plugins to inject UI components into any
 * core page without modifying page code.
 *
 * Widget zones:
 * - main-before: Above page content
 * - main-after: Below page content
 *
 * The pathname is extracted from request headers set by middleware, which
 * carries no matched-route params — so widgets resolved here always receive
 * an empty param map. A page whose widgets need route params must fetch its
 * own bundle and render its own zones.
 */
export default async function CoreLayout({ children }: { children: ReactNode }) {
    // Extract pathname from middleware-set header for per-route widgets
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
