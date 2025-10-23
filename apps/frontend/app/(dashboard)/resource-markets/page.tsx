import type { MarketComparisonStats, MarketDocument } from '@tronrelic/shared';
import { MarketDashboard } from '../../../features/markets';
import { getMarketComparison } from '../../../lib/api';
import { buildMetadata } from '../../../lib/seo';
import { Send, Globe, ExternalLink, Zap } from 'lucide-react';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

export const metadata = buildMetadata({
  title: 'Rent TRON Energy – Compare Real-Time Prices Across 20+ Platforms | TronRelic',
  description: 'Find the cheapest TRON energy rental rates and save up to 90% on USDT TRC20 transfer fees. Real-time marketplace comparison across 20+ providers with instant pricing updates.',
  path: '/resource-markets',
  keywords: ['rent TRON energy', 'TRON energy rental', 'cheapest TRON energy', 'USDT TRC20 fees', 'TRON energy marketplace', 'buy TRON energy', 'TRX energy comparison']
});

export default async function MarketsPage(): Promise<JSX.Element> {
  const { markets, stats } = await getMarketComparison();
  return (
    <div className="page">
      <section className={`page-header ${styles.header_with_cta}`}>
        <div className={styles.title_row}>
          <h1 className="page-title">
            <Zap className={styles.title_icon} size={64} />
            Energy Markets
          </h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
            <a
              href="https://https://tronsave.io/?ref=tcrq2fjvon5mphjg"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.bot_cta_link}
            >
              <Globe size={18} />
              <span>Rent Energy via Web</span>
              <ExternalLink size={14} />
            </a>
          </div>
        </div>
        <p className={styles.subtitle}>Rent TRON energy at the cheapest rates across 20+ platforms and save up to 90% on USDT TRC20 transfer fees. Compare real-time pricing from top energy rental marketplaces including TronSave, JustLend DAO, and CatFee to find the best deals for your transactions. Live price tracking updates every 10 minutes to ensure you always get the lowest cost per energy unit.</p>
      </section>

      <MarketDashboard markets={markets} stats={stats} initialHistory={[]} />
    </div>
  );
}
