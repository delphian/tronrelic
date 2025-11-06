'use client';

import { useEffect, useMemo, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { MarketComparisonStats, MarketDocument } from '@tronrelic/shared';
import { MarketTable } from './MarketTable';
import type { MarketHistoryRecord } from '../types';
import styles from './MarketDashboard.module.css';

/**
 * Props for the MarketDashboard component.
 */
interface MarketDashboardProps {
    /** Frontend plugin context for dependency injection */
    context: IFrontendPluginContext;
    /** Initial market data from server-side fetch or parent component */
    markets: MarketDocument[];
    /** Optional pre-calculated comparison statistics */
    stats?: MarketComparisonStats;
}

/**
 * Main dashboard component for energy market comparison.
 *
 * Displays summary statistics cards showing total markets tracked, best available
 * price, average cost, and median cost. Below the summary, renders the MarketTable
 * component with sortable, expandable rows for detailed market information.
 *
 * The component receives real-time market updates from the parent MarketsPage component
 * via WebSocket subscriptions, keeping pricing information current without manual refreshes.
 * Historical pricing data is fetched on-demand when users expand a market row.
 *
 * @param context - Frontend plugin context providing UI components and API client
 * @param markets - Array of market documents to display (updated via WebSocket by parent)
 * @param stats - Optional pre-calculated statistics (if not provided, calculated from markets)
 * @returns A comprehensive market comparison dashboard with stats and sortable table
 */
export function MarketDashboard({ context, markets: initialMarkets, stats }: MarketDashboardProps) {
    const { ui, api } = context;
    const [markets, setMarkets] = useState<MarketDocument[]>(initialMarkets);
    const [expandedGuid, setExpandedGuid] = useState<string | null>(null);
    const [history, setHistory] = useState<MarketHistoryRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    /**
     * Handles market row expansion and collapse.
     *
     * When a user clicks a market row, this callback either expands the row to show
     * pricing details and historical data (if collapsed) or collapses it (if already expanded).
     * On expansion, fetches the market's 30-day pricing history from the backend API.
     *
     * @param market - The market document to toggle expansion for
     */
    const onToggleExpand = async (market: MarketDocument) => {
        if (expandedGuid === market.guid) {
            setExpandedGuid(null);
            return;
        }

        setExpandedGuid(market.guid);
        setLoading(true);
        setError(null);
        try {
            const response = await api.get(`/plugins/resource-markets/markets/${market.guid}/history`);
            if (response.success && response.history) {
                setHistory(response.history);
            }
        } catch (fetchError) {
            console.error('Failed to load market history:', fetchError);
            setError(fetchError instanceof Error ? fetchError.message : 'Failed to load market history');
        } finally {
            setLoading(false);
        }
    };

    /**
     * Syncs parent market data updates to local state.
     *
     * The parent MarketsPage component receives real-time updates via WebSocket and passes
     * them down as the `initialMarkets` prop. This effect ensures those updates are reflected
     * in the dashboard's local state, keeping the displayed data current without polling.
     */
    useEffect(() => {
        setMarkets(initialMarkets);
    }, [initialMarkets]);

    /**
     * Calculates summary statistics from current market data.
     *
     * Computes total markets, best price, average price, median price, and worst price
     * from the live market data. These statistics update automatically when market data
     * refreshes, providing real-time insights into market conditions.
     */
    const summaryStats = useMemo<MarketComparisonStats>(() => {
        if (!markets.length) {
            return stats ?? { totalMarkets: 0 };
        }

        const usdtCostValues = markets
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
            totalMarkets: markets.length,
            averagePrice: averagePrice ?? stats?.averagePrice,
            medianPrice: medianPrice ?? stats?.medianPrice,
            bestPrice: bestPrice ?? stats?.bestPrice,
            worstPrice: worstPrice ?? stats?.worstPrice
        } satisfies MarketComparisonStats;
    }, [markets, stats]);

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
                        <ui.Card key={item.label} tone="muted" padding="md">
                            <div className={styles.stat_card__label}>{item.label}</div>
                            <div className={styles.stat_card__value}>{item.value}</div>
                            <div className={styles.stat_card__delta}>{item.helper}</div>
                        </ui.Card>
                    ))}
                </section>

                <div className={styles.dashboard_container}>
                    <MarketTable
                        context={context}
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

/**
 * Formats a USDT transfer cost value for display.
 *
 * @param value - The cost in TRX (can be undefined or null)
 * @returns Formatted string with 3 decimal places or em-dash for missing values
 */
function formatUsdtCost(value?: number): string {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return `${value.toFixed(3)} TRX`;
    }
    return '—';
}
