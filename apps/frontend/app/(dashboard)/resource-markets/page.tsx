import type { MarketComparisonStats, MarketDocument } from '@tronrelic/shared';
import { MarketDashboard } from '../../../features/markets';
import type { MarketHistoryRecord } from '../../../lib/api';
import { buildMetadata } from '../../../lib/seo';
import { getApiUrl } from '../../../lib/config';

interface MarketsResponse {
  success: boolean;
  markets: MarketDocument[];
  stats: MarketComparisonStats;
}

export const dynamic = 'force-dynamic';

export const metadata = buildMetadata({
  title: 'TRON Energy Market Comparison | TronRelic',
  description: 'Monitor TRON energy rental desks with real-time pricing, availability, and reliability intelligence refreshed continuously.',
  path: '/resource-markets',
  keywords: ['TRON energy market', 'TRON energy rental', 'TRX delegation prices']
});

async function fetchMarkets(): Promise<MarketsResponse> {
  const response = await fetch(getApiUrl('/markets/compare'), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load markets');
  }
  return response.json();
}

export default async function MarketsPage(): Promise<JSX.Element> {
  const data = await fetchMarkets();
  return (
    <div className="page">
      <section className="page-header">
        <h1 className="page-title">Energy Markets</h1>
        <p className="page-subtitle">Compare pricing desks, monitor availability, and evaluate reliability trends.</p>
      </section>
      <MarketDashboard markets={data.markets} stats={data.stats} initialHistory={[]} />
    </div>
  );
}
