'use client';

import { SystemHealthMonitor, useSystemAuth } from '../../../../features/system';

/**
 * System health monitoring page.
 *
 * Displays infrastructure health metrics including database connectivity, Redis cache
 * status, server resource usage (CPU, memory, disk), and process uptime. Provides
 * detailed visibility into system performance and resource utilization. Requires
 * admin authentication.
 */
export default function SystemHealthPage() {
    const { token } = useSystemAuth();

    return <SystemHealthMonitor token={token} />;
}
