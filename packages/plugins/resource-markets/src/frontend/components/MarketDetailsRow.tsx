'use client';

import { useMemo } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { MarketDocument } from '@tronrelic/shared';
import type { MarketHistoryRecord } from '../types';
import styles from './MarketDetailsRow.module.css';

interface MarketDetailsRowProps {
    context: IFrontendPluginContext;
    market: MarketDocument;
    history: MarketHistoryRecord[];
    loading: boolean;
    error: string | null;
    isExpanded: boolean;
    onToggle: () => void;
}

/**
 * Renders an expandable table row displaying detailed market information inline.
 *
 * When expanded, shows market statistics, pricing details, and historical trend chart.
 * This component uses the inline dropdown pattern instead of a slideout panel for
 * better integration with the table structure.
 *
 * @param context - Frontend plugin context for UI components
 * @param market - The market to display details for
 * @param history - Historical pricing data for the trend chart
 * @param loading - Whether history data is being fetched
 * @param error - Error message from history fetch failures
 * @param isExpanded - Whether the details are currently visible
 * @param onToggle - Callback to toggle expansion state
 * @returns An expandable table row with market details or null if collapsed
 */
export function MarketDetailsRow({
    context,
    market,
    history,
    loading,
    error,
    isExpanded,
    onToggle
}: MarketDetailsRowProps) {
    const { ui, charts } = context;

    const priceSeries = useMemo(() => {
        if (!history.length) {
            return {
                id: 'usdt-cost',
                label: 'Cost per USDT TX (TRX)',
                data: [] as { date: string; value: number }[],
                color: '#6DA3FF'
            };
        }

        const data = history
            .filter(point => typeof point.minUsdtTransferCost === 'number' && point.minUsdtTransferCost > 0)
            .map(point => ({
                date: point.recordedAt,
                value: point.minUsdtTransferCost!
            }))
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        return {
            id: 'usdt-cost',
            label: 'Cost per USDT TX (TRX)',
            data,
            color: '#6DA3FF'
        };
    }, [history]);

    if (!isExpanded) {
        return null;
    }

    return (
        <tr className={styles.details_row}>
            <td colSpan={6} className={styles.details_cell}>
                <div className={styles.details_container}>
                    <div className="stack" style={{ gap: '1.5rem' }}>
                        <div>
                            <h3>{market.name}</h3>
                            <p className="text-subtle">{market.description ?? 'Energy rental marketplace'}</p>
                        </div>

                        <section className={styles.stat_grid}>
                            <ui.Card tone="muted" padding="sm">
                                <div className="stat-card__label">Cost per USDT TX</div>
                                <div className="stat-card__value">
                                    {market.pricingDetail?.minUsdtTransferCost
                                        ? `${market.pricingDetail.minUsdtTransferCost.toFixed(3)} TRX`
                                        : '—'}
                                </div>
                            </ui.Card>
                            <ui.Card tone="muted" padding="sm">
                                <div className="stat-card__label">Availability</div>
                                <div className="stat-card__value">{market.availabilityPercent?.toFixed(1) ?? '0.0'}%</div>
                            </ui.Card>
                            <ui.Card tone="muted" padding="sm">
                                <div className="stat-card__label">Reliability</div>
                                <div className="stat-card__value">{Math.round((market.reliability ?? 0) * 100)}%</div>
                            </ui.Card>
                            <ui.Card tone="muted" padding="sm">
                                <div className="stat-card__label">Updated</div>
                                <div className="stat-card__value">
                                    <ui.ClientTime date={market.lastUpdated} format="time" />
                                </div>
                            </ui.Card>
                        </section>

                        <section>
                            <h4>Cost per USDT TX trend</h4>
                            {loading ? (
                                <ui.Skeleton style={{ height: '200px' }} />
                            ) : priceSeries.data.length ? (
                                <charts.LineChart
                                    series={[priceSeries]}
                                    yAxisFormatter={value => `${value.toFixed(3)} TRX`}
                                    emptyLabel="No price history available"
                                />
                            ) : (
                                <p className="text-subtle">No price history available</p>
                            )}
                        </section>

                        {error && <p className="text-subtle">{error}</p>}
                    </div>
                </div>
            </td>
        </tr>
    );
}
