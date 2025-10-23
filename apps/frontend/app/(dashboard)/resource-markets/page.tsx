import type { MarketComparisonStats, MarketDocument } from '@tronrelic/shared';
import { MarketDashboard } from '../../../features/markets';
import { getMarketComparison } from '../../../lib/api';
import { buildMetadata } from '../../../lib/seo';
import { Send, ExternalLink } from 'lucide-react';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata = buildMetadata({
  title: 'TRON Energy Market Comparison | TronRelic',
  description: 'Monitor TRON energy rental desks with real-time pricing, availability, and reliability intelligence refreshed continuously.',
  path: '/resource-markets',
  keywords: ['TRON energy market', 'TRON energy rental', 'TRX delegation prices']
});

export default async function MarketsPage(): Promise<JSX.Element> {
  const { markets, stats } = await getMarketComparison();
  return (
    <div className="page">
      <section className={`page-header ${styles.header_with_cta}`}>
        <div className={styles.title_row}>
          <h1 className="page-title">Energy Markets</h1>
          <a
            href="https://t.me/BuyEnergyTronsave_bot?start=tcrq2fjvon5mphjg"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.bot_cta_link}
          >
            <Send size={18} />
            <span>Rent Energy via Bot</span>
            <ExternalLink size={14} />
          </a>
        </div>
        <p className="page-subtitle">Compare pricing desks, monitor availability, and evaluate reliability trends.</p>
      </section>

      <MarketDashboard markets={markets} stats={stats} initialHistory={[]} />
    </div>
  );
}
