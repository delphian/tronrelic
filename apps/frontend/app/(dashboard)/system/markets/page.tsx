'use client';

import { MarketMonitor, useSystemAuth } from '../../../../features/system';

/**
 * Market monitoring page.
 *
 * Displays energy market health status, data freshness, and fetcher reliability metrics.
 * Provides detailed visibility into market platform availability, last update timestamps,
 * and pricing data quality. Includes manual refresh trigger for testing market fetchers.
 * Requires admin authentication.
 */
export default function MarketMonitorPage() {
    const { token } = useSystemAuth();

    return <MarketMonitor token={token} />;
}
