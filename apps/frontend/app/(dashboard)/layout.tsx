import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { WidgetZone, fetchWidgetsForRoute } from '../../components/widgets';

/**
 * Dashboard layout with widget zone support.
 *
 * Fetches widgets for the current route during SSR and renders them in
 * designated zones. This allows plugins to inject UI components into any
 * page without modifying core page code.
 *
 * Widget zones:
 * - main-before: Above page content
 * - main-after: Below page content
 *
 * The pathname is extracted from request headers set by middleware.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
    // Extract pathname from middleware-set header for per-route widgets
    const headersList = await headers();
    const pathname = headersList.get('x-pathname') || '/';

    const widgets = await fetchWidgetsForRoute(pathname);

    return (
        <div className="dashboard-layout">
            <WidgetZone name="main-before" widgets={widgets} />
            {children}
            <WidgetZone name="main-after" widgets={widgets} />
        </div>
    );
}
