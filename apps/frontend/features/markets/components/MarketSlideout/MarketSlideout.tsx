'use client';

import { Fragment, useMemo, useState } from 'react';
import type { MarketDocument } from '@tronrelic/shared';
import type { MarketHistoryRecord } from '../../../../lib/api';
import { X } from 'lucide-react';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { LineChart } from '../../../charts/components/LineChart';
import { Tooltip } from '../../../../components/ui/Tooltip';
import styles from './MarketSlideout.module.css';

interface MarketSlideoutProps {
    /** The market to display in the slideout panel. When null, the slideout is closed. */
    market: MarketDocument | null;
    /** Historical pricing data for the selected market, used to render trend charts. */
    history: MarketHistoryRecord[];
    /** Whether the history data is currently being fetched from the backend. */
    loading: boolean;
    /** Error message from failed history fetch attempts, displayed to the user. */
    error: string | null;
    /** Callback invoked when the user closes the slideout (via X button or backdrop click). */
    onClose: () => void;
}

/**
 * Renders a slideout panel that displays detailed market information with tabbed navigation.
 *
 * This component replaces the previous bottom detail card + dropdown pricing approach with
 * a unified slideout that appears from the right side of the screen. It provides two tabs:
 * - Details: Market metadata, stats, trend chart, and bulk discount information
 * - Pricing: Comprehensive breakdown of USDT transfer costs and platform pricing tiers
 *
 * The slideout is controlled via the `market` prop: when non-null, it appears; when null,
 * it's hidden. This allows parent components to manage visibility by toggling the selected market.
 *
 * @param market - The currently selected market to display, or null to hide the slideout
 * @param history - Historical pricing data for rendering the trend chart
 * @param loading - Whether history data is being fetched (shows skeleton loader)
 * @param error - Error message from history fetch failures
 * @param onClose - Callback to notify parent when slideout should close
 * @returns A fixed-position slideout panel with tabbed market details
 */
export function MarketSlideout({ market, history, loading, error, onClose }: MarketSlideoutProps) {
    const [activeTab, setActiveTab] = useState<'details' | 'pricing'>('details');

    /**
     * Transforms historical market data into a format compatible with the LineChart component.
     * Filters out invalid data points (null/zero/negative costs) and maps recordedAt timestamps
     * to the expected { date, value } structure. This ensures the chart only displays meaningful
     * pricing trends without gaps or misleading data.
     */
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
                value: point.minUsdtTransferCost ?? 0
            }));

        return {
            id: 'usdt-cost',
            label: 'Cost per USDT TX (TRX)',
            data,
            color: '#6DA3FF'
        };
    }, [history]);

    // When market is null, the slideout is closed
    if (!market) {
        return null;
    }

    return (
        <Fragment>
            {/* Backdrop: semi-transparent overlay that closes slideout when clicked */}
            <div
                className={styles.backdrop}
                onClick={onClose}
                aria-label="Close market details"
            />

            {/* Slideout panel: fixed right side, slides in with animation */}
            <div className={styles.panel}>
                {/* Header with tabs and close button */}
                <div className={styles.header}>
                    <div className={styles.tabs}>
                        <button
                            className={activeTab === 'details' ? `${styles.tab} ${styles['tab--active']}` : styles.tab}
                            onClick={() => setActiveTab('details')}
                        >
                            Details
                        </button>
                        <button
                            className={activeTab === 'pricing' ? `${styles.tab} ${styles['tab--active']}` : styles.tab}
                            onClick={() => setActiveTab('pricing')}
                        >
                            Pricing
                        </button>
                    </div>
                    <button
                        className={styles.close}
                        onClick={onClose}
                        aria-label="Close market details"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body: scrollable content area with tab-specific content */}
                <div className={styles.body}>
                    {activeTab === 'details' ? (
                        <div className="stack" style={{ gap: '1.5rem' }}>
                            {/* Market title and description */}
                            <div>
                                <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{market.name}</h2>
                                <p className="text-subtle" style={{ margin: '0.5rem 0 0' }}>
                                    {market.description ?? 'Historical reliability and pricing trends for this marketplace.'}
                                </p>
                                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                                    {market.isBestDeal && <Badge tone="success">Best deal</Badge>}
                                    {market.bulkDiscount?.hasDiscount && <Badge tone="warning">Bulk discounts</Badge>}
                                </div>
                            </div>

                            {/* Market stats: 4-card grid */}
                            <section className="stat-grid">
                                <Card tone="muted" padding="sm">
                                    <div className="stat-card__label">Cost per USDT TX</div>
                                    <div className="stat-card__value">
                                        {market.pricingDetail?.minUsdtTransferCost
                                            ? `${market.pricingDetail.minUsdtTransferCost.toFixed(3)} TRX`
                                            : '—'}
                                    </div>
                                    <div className="stat-card__delta">Minimum cost to send 1 USDT (65k energy)</div>
                                </Card>
                                <Card tone="muted" padding="sm">
                                    <div className="stat-card__label">Availability</div>
                                    <div className="stat-card__value">{market.availabilityPercent?.toFixed(1) ?? '0.0'}%</div>
                                    <div className="stat-card__delta">Inventory ready to rent</div>
                                </Card>
                                <Card tone="muted" padding="sm" style={{ overflow: 'visible' }}>
                                    <div className="stat-card__label" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', overflow: 'visible' }}>
                                        Data Feed Reliability
                                        <Tooltip content="Measures how often TronRelic successfully fetches pricing data from this marketplace's API. This reflects API uptime and data availability, not order fulfillment rates.">
                                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ cursor: 'help', opacity: 0.6 }}>
                                                <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
                                                <path d="M7 10V7M7 4H7.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                            </svg>
                                        </Tooltip>
                                    </div>
                                    <div className="stat-card__value">{Math.round((market.reliability ?? 0) * 100)}%</div>
                                    <div className="stat-card__delta">API fetch success rate</div>
                                </Card>
                                <Card tone="muted" padding="sm">
                                    <div className="stat-card__label">Updated</div>
                                    <div className="stat-card__value">
                                        <ClientTime date={market.lastUpdated} format="time" />
                                    </div>
                                    <div className="stat-card__delta">Local time</div>
                                </Card>
                            </section>

                            {/* Trend chart */}
                            <section>
                                <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>Cost per USDT TX trend</h3>
                                {loading ? (
                                    <Skeleton style={{ height: '240px' }} />
                                ) : priceSeries.data.length ? (
                                    <LineChart
                                        series={[priceSeries]}
                                        yAxisFormatter={value => `${value.toFixed(3)} TRX`}
                                        xAxisFormatter={date =>
                                            date.toLocaleString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })
                                        }
                                        emptyLabel="No price history collected for this market yet."
                                    />
                                ) : (
                                    <div className="text-subtle">No price history captured for this market yet.</div>
                                )}
                            </section>

                            {error && <p className="text-subtle">{error}</p>}

                            {/* Bulk discount information */}
                            {market.bulkDiscount?.hasDiscount && (
                                <section className="surface surface--padding-sm" style={{ background: 'rgba(11, 16, 28, 0.6)', borderRadius: 'var(--radius-md)' }}>
                                    <h4 style={{ marginTop: 0, fontSize: '1rem' }}>Bulk discount insights</h4>
                                    {market.bulkDiscount.summary && (
                                        <p className="text-subtle" style={{ marginTop: 0 }}>{market.bulkDiscount.summary}</p>
                                    )}
                                    {market.bulkDiscount.tiers && market.bulkDiscount.tiers.length > 0 ? (
                                        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.4rem' }}>
                                            {[...market.bulkDiscount.tiers]
                                                .sort((a, b) => a.minEnergy - b.minEnergy)
                                                .map(tier => (
                                                    <li key={`${tier.minEnergy}-${tier.price}`} className="text-subtle">
                                                        {tier.minEnergy.toLocaleString()} energy ⇒ {tier.price.toFixed(2)} TRX ({tier.discountPercent.toFixed(1)}% off)
                                                    </li>
                                                ))}
                                        </ul>
                                    ) : (
                                        <p className="text-subtle" style={{ margin: 0 }}>Volume orders unlock better rates on this desk.</p>
                                    )}
                                </section>
                            )}
                        </div>
                    ) : (
                        /* Pricing tab: detailed breakdown of costs and platform fees */
                        <div className="stack" style={{ gap: '1.5rem' }}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Pricing Breakdown</h2>
                                <p className="text-subtle" style={{ margin: '0.5rem 0 0' }}>
                                    Comprehensive pricing data across rental durations and energy amounts.
                                </p>
                            </div>

                            {market.pricingDetail ? (
                                <div style={{ display: 'grid', gap: '2rem' }}>
                                    {/* USDT Transfer Cost section */}
                                    {market.pricingDetail.usdtTransferCosts && market.pricingDetail.usdtTransferCosts.length > 0 && (
                                        <section>
                                            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>USDT Transfer Cost (65k energy)</h3>
                                            <Card tone="muted" padding="sm">
                                                <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
                                                    {market.pricingDetail.usdtTransferCosts.map((cost, i, arr) => {
                                                        const hours = Math.floor(cost.durationMinutes / 60);
                                                        const days = Math.floor(hours / 24);
                                                        const durationLabel = days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : `${cost.durationMinutes}m`;
                                                        return (
                                                            <div
                                                                key={i}
                                                                style={{
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    padding: '0.5rem 0',
                                                                    borderBottom: i < arr.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none'
                                                                }}
                                                            >
                                                                <span>1 USDT transfer @ {durationLabel}</span>
                                                                <strong>{cost.costTrx.toFixed(8)} TRX</strong>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </Card>
                                        </section>
                                    )}

                                    {/* Platform Pricing section */}
                                    {market.pricingDetail.siteFees && (
                                        <section>
                                            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem' }}>Platform Pricing</h3>
                                            <Card tone="muted" padding="sm">
                                                <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.9rem' }}>
                                                    {(() => {
                                                        // Group by duration to match USDT Transfer Cost section
                                                        const uniqueDurations = new Map<string, typeof market.pricingDetail.siteFees.points>();
                                                        market.pricingDetail.siteFees.points.forEach(point => {
                                                            if (!uniqueDurations.has(point.duration)) {
                                                                uniqueDurations.set(point.duration, []);
                                                            }
                                                            uniqueDurations.get(point.duration)!.push(point);
                                                        });

                                                        // For each duration, show a sample of energy amounts
                                                        return Array.from(uniqueDurations.entries()).flatMap(([duration, points], groupIdx) => {
                                                            // Pick representative energy amounts: smallest, middle, and largest
                                                            const sortedPoints = [...points].sort((a, b) => a.energy - b.energy);
                                                            const sampled = [
                                                                sortedPoints[0], // Smallest (32k)
                                                                sortedPoints[Math.floor(sortedPoints.length / 3)], // ~64k-256k
                                                                sortedPoints[Math.floor(sortedPoints.length * 2 / 3)], // ~1M
                                                                sortedPoints[sortedPoints.length - 1] // Largest (10M)
                                                            ].filter((p, i, arr) => arr.indexOf(p) === i); // Remove duplicates

                                                            const totalItems = Array.from(uniqueDurations.values()).reduce((sum, group) => {
                                                                const sortedGroup = [...group].sort((a, b) => a.energy - b.energy);
                                                                const sampledGroup = [
                                                                    sortedGroup[0],
                                                                    sortedGroup[Math.floor(sortedGroup.length / 3)],
                                                                    sortedGroup[Math.floor(sortedGroup.length * 2 / 3)],
                                                                    sortedGroup[sortedGroup.length - 1]
                                                                ].filter((p, i, arr) => arr.indexOf(p) === i);
                                                                return sum + sampledGroup.length;
                                                            }, 0);

                                                            let itemsSoFar = 0;
                                                            for (let g = 0; g < groupIdx; g++) {
                                                                const prevGroup = Array.from(uniqueDurations.values())[g];
                                                                const sortedPrevGroup = [...prevGroup].sort((a, b) => a.energy - b.energy);
                                                                const sampledPrevGroup = [
                                                                    sortedPrevGroup[0],
                                                                    sortedPrevGroup[Math.floor(sortedPrevGroup.length / 3)],
                                                                    sortedPrevGroup[Math.floor(sortedPrevGroup.length * 2 / 3)],
                                                                    sortedPrevGroup[sortedPrevGroup.length - 1]
                                                                ].filter((p, i, arr) => arr.indexOf(p) === i);
                                                                itemsSoFar += sampledPrevGroup.length;
                                                            }

                                                            return sampled.map((point, i) => {
                                                                const usdtTransferCount = point.energy / 65000;
                                                                const pricePerTransfer = point.priceInTrx / usdtTransferCount;

                                                                let transferLabel: string;
                                                                if (usdtTransferCount >= 1) {
                                                                    transferLabel = `${Math.round(usdtTransferCount)} USDT tx`;
                                                                } else {
                                                                    transferLabel = `${usdtTransferCount.toFixed(2)} USDT tx`;
                                                                }

                                                                const isLastItem = (itemsSoFar + i + 1) === totalItems;

                                                                return (
                                                                    <div
                                                                        key={`${duration}-${i}`}
                                                                        style={{
                                                                            display: 'flex',
                                                                            justifyContent: 'space-between',
                                                                            padding: '0.5rem 0',
                                                                            borderBottom: isLastItem ? 'none' : '1px solid rgba(255, 255, 255, 0.05)'
                                                                        }}
                                                                    >
                                                                        <span>{transferLabel} @ {point.duration}</span>
                                                                        <strong>{pricePerTransfer.toFixed(4)} TRX/tx</strong>
                                                                    </div>
                                                                );
                                                            });
                                                        });
                                                    })()}
                                                </div>
                                            </Card>
                                        </section>
                                    )}
                                </div>
                            ) : (
                                <div className="text-subtle">No detailed pricing data available for this market.</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </Fragment>
    );
}
