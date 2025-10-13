import type { MarketComparisonStats, MarketDocument } from '@tronrelic/shared';
import { MarketDashboard } from '../../../features/markets';
import type { MarketHistoryRecord } from '../../../lib/api';
import { buildMetadata } from '../../../lib/seo';

interface MarketsResponse {
  success: boolean;
  markets: MarketDocument[];
  stats: MarketComparisonStats;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_BASE_URL ?? 'http://localhost:4000/api';

export const dynamic = 'force-dynamic';

export const metadata = buildMetadata({
  title: 'TRON Energy Market Comparison | TronRelic',
  description: 'Monitor TRON energy rental desks with real-time pricing, availability, and reliability intelligence refreshed continuously.',
  path: '/resource-markets',
  keywords: ['TRON energy market', 'TRON energy rental', 'TRX delegation prices']
});

async function fetchMarkets(): Promise<MarketsResponse> {
  const response = await fetch(`${API_BASE_URL}/markets/compare`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('Failed to load markets');
  }
  return response.json();
}

async function fetchHistory(guid: string): Promise<MarketHistoryRecord[]> {
  const response = await fetch(`${API_BASE_URL}/markets/${guid}/history?limit=168`, {
    cache: 'no-store'
  });
  if (!response.ok) {
    return [];
  }
  const data = (await response.json()) as { success: boolean; history: MarketHistoryRecord[] };
  return data.history ?? [];
}

export default async function MarketsPage() {
  const data = await fetchMarkets();
  const initialMarket = data.markets[0];
  const history = initialMarket ? await fetchHistory(initialMarket.guid) : [];
  return (
    <main>
      <div className="page">
        <section className="page-header">
          <h1 className="page-title">Market intelligence</h1>
          <p className="page-subtitle">Compare pricing desks, monitor availability, and evaluate reliability trends.</p>
        </section>
        <MarketDashboard markets={data.markets} stats={data.stats} initialHistory={history} />
      </div>
    </main>
  );
}
