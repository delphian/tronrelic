'use client';

import { BlockchainMonitor, useSystemAuth } from '../../../../features/system';

/**
 * Blockchain monitoring page.
 *
 * Displays blockchain sync status, transaction processing metrics, and block indexing
 * statistics. Provides detailed visibility into blockchain synchronization progress,
 * lag metrics, and observer performance. Requires admin authentication.
 */
export default function BlockchainMonitorPage() {
    const { token } = useSystemAuth();

    return <BlockchainMonitor token={token} />;
}
