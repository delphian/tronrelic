'use client';

import { useSystemAuth } from '../../../../features/system';
import { AnalyticsDashboard } from '../../../../modules/user';

/**
 * System analytics dashboard page.
 *
 * Thin wrapper that delegates to AnalyticsDashboard from the user module.
 * Displays aggregate traffic insights: sources, landing pages, geography,
 * devices, campaigns, engagement, conversion funnel, and retention.
 * Requires admin authentication.
 */
export default function SystemAnalyticsPage() {
    const { token } = useSystemAuth();

    return <AnalyticsDashboard token={token} />;
}
