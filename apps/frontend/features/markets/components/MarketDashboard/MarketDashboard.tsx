'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarketComparisonStats, MarketDocument } from '@tronrelic/shared';
import { MarketTable } from '../MarketTable';
import { Card } from '../../../../components/ui/Card';
import { getMarketHistory, getMarkets, type MarketHistoryRecord } from '../../../../lib/api';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { setMarkets } from '../../slice';
import styles from './MarketDashboard.module.css';

interface MarketDashboardProps {
  markets: MarketDocument[];
  stats?: MarketComparisonStats;
  initialHistory: MarketHistoryRecord[];
}

export function MarketDashboard({ markets, stats, initialHistory }: MarketDashboardProps) {
  const dispatch = useAppDispatch();
  const [expandedGuid, setExpandedGuid] = useState<string | null>(null);
  const [history, setHistory] = useState(initialHistory);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const realtimeMarkets = useAppSelector(state => state.markets.markets);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  /**
   * Handles market expansion/collapse, toggling the inline dropdown and loading historical data.
   *
   * When a user clicks a market row, this callback either expands the row to show details (if collapsed)
   * or collapses it (if already expanded). On expansion, it fetches the market's pricing history from the
   * backend API and stores it in local state for the dropdown to display. Loading and error states
   * are managed to provide feedback during the fetch operation.
   *
   * @param market - The market document to toggle expansion for
   */
  const onToggleExpand = async (market: MarketDocument) => {
    // If clicking the same market, collapse it
    if (expandedGuid === market.guid) {
      setExpandedGuid(null);
      return;
    }

    // Expand the new market and load its history
    setExpandedGuid(market.guid);
    setLoading(true);
    setError(null);
    try {
      const historyRecords = await getMarketHistory(market.guid);
      setHistory(historyRecords);
    } catch (fetchError) {
      console.error(fetchError);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load market history');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Polls the backend API every 5 minutes to refresh market data in the background.
   * This keeps the leaderboard up-to-date with the latest pricing, availability, and
   * order information without requiring manual page refreshes. The interval is cleared
   * when the component unmounts to prevent memory leaks.
   */
  useEffect(() => {
    const fetchMarketsData = async () => {
      try {
        const freshMarkets = await getMarkets();
        dispatch(setMarkets(freshMarkets));
      } catch (fetchError) {
        console.error('Failed to auto-refresh market data:', fetchError);
      }
    };

    // Set up polling interval: fetch fresh data every 5 minutes (300,000ms)
    pollIntervalRef.current = setInterval(fetchMarketsData, 300_000);

    // Cleanup: clear interval when component unmounts
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [dispatch]);

  const marketsForSummary = realtimeMarkets.length ? realtimeMarkets : markets;

  const summaryStats = useMemo<MarketComparisonStats>(() => {
    if (!marketsForSummary.length) {
      return stats ?? { totalMarkets: 0 };
    }

    const usdtCostValues = marketsForSummary
      .map(market => market.pricingDetail?.minUsdtTransferCost)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);

    const averagePrice = usdtCostValues.length
      ? Number((usdtCostValues.reduce((sum, value) => sum + value, 0) / usdtCostValues.length).toFixed(3))
      : stats?.averagePrice;

    const medianPrice = usdtCostValues.length
      ? (() => {
          const sorted = [...usdtCostValues].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          if (sorted.length % 2 === 0) {
            return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(3));
          }
          return Number(sorted[mid].toFixed(3));
        })()
      : stats?.medianPrice;

    const bestPrice = usdtCostValues.length ? Number(Math.min(...usdtCostValues).toFixed(3)) : stats?.bestPrice;
    const worstPrice = usdtCostValues.length ? Number(Math.max(...usdtCostValues).toFixed(3)) : stats?.worstPrice;

    return {
      totalMarkets: marketsForSummary.length,
      averagePrice: averagePrice ?? stats?.averagePrice,
      medianPrice: medianPrice ?? stats?.medianPrice,
      bestPrice: bestPrice ?? stats?.bestPrice,
      worstPrice: worstPrice ?? stats?.worstPrice
    } satisfies MarketComparisonStats;
  }, [marketsForSummary, stats]);

  const summaryItems = useMemo(
    () => [
      {
        label: 'Tracked markets',
        value: summaryStats.totalMarkets.toLocaleString(),
        helper: 'Active desks streaming data'
      },
      {
        label: 'Best available price',
        value: formatUsdtCost(summaryStats.bestPrice),
        helper: 'Lowest cost to send 1 USDT'
      },
      {
        label: 'Average cost per USDT TX',
        value: formatUsdtCost(summaryStats.averagePrice),
        helper: 'Mean cost across all markets'
      },
      {
        label: 'Median cost per USDT TX',
        value: formatUsdtCost(summaryStats.medianPrice),
        helper: 'Typical market pricing'
      }
    ],
    [summaryStats]
  );

  return (
    <>
      <div className={`grid ${styles.grid}`}>
        <section className={styles.stat_grid}>
          {summaryItems.map(item => (
            <Card key={item.label} tone="muted" padding="sm">
              <div className={styles.stat_card__label}>{item.label}</div>
              <div className={styles.stat_card__value}>{item.value}</div>
              <div className={styles.stat_card__delta}>{item.helper}</div>
            </Card>
          ))}
        </section>

        <div className={styles.dashboard_container}>
          <MarketTable
            initialMarkets={markets}
            onToggleExpand={onToggleExpand}
            expandedGuid={expandedGuid ?? undefined}
            history={history}
            historyLoading={loading}
            historyError={error}
          />
        </div>
      </div>
    </>
  );
}

function formatUsdtCost(value?: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `${value.toFixed(3)} TRX`;
  }
  return '—';
}

