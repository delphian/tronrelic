'use client';

import { SystemOverview, useSystemAuth } from '../../../../features/system';

/**
 * System overview page.
 *
 * Displays consolidated system metrics including blockchain sync status, market health,
 * scheduler status, and infrastructure metrics. Provides at-a-glance visibility into
 * overall system health. Requires admin authentication.
 */
export default function SystemOverviewPage() {
    const { token } = useSystemAuth();

    return <SystemOverview token={token} />;
}
