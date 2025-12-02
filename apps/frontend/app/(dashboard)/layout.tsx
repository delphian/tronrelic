import type { ReactNode } from 'react';
import { WidgetZone, fetchWidgetsForRoute } from '../../components/widgets';

/**
 * Dashboard layout with widget zone support.
 *
 * Fetches widgets for the homepage during SSR and renders them in designated
 * zones. This allows plugins to inject UI components into the homepage without
 * modifying core page code.
 *
 * Widget zones:
 * - main-before: Above page content
 * - main-after: Below page content
 *
 * Note: Currently fetches widgets for '/' (homepage) only. Future enhancement
 * will extract the actual pathname from request context to support per-page widgets.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
    // Fetch widgets for homepage during SSR
    // TODO: Extract actual pathname from request context for per-page widgets
    const widgets = await fetchWidgetsForRoute('/');

    return (
        <div className="dashboard-layout">
            <WidgetZone name="main-before" widgets={widgets} />
            {children}
            <WidgetZone name="main-after" widgets={widgets} />
        </div>
    );
}
