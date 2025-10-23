'use client';

import { useMemo } from 'react';
import {
    ExternalLink,
    Twitter,
    Send,
    MessageCircle,
    Github,
    Youtube,
    Linkedin,
    Facebook,
    MessageSquare
} from 'lucide-react';
import type { MarketDocument } from '@tronrelic/shared';
import type { MarketHistoryRecord } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { LineChart } from '../../../charts/components/LineChart';
import { Tooltip } from '../../../../components/ui/Tooltip';
import styles from './MarketDetailsRow.module.css';

interface MarketDetailsRowProps {
    /** The market to display details for. */
    market: MarketDocument;
    /** Historical pricing data for the selected market, used to render trend charts. */
    history: MarketHistoryRecord[];
    /** Whether the history data is currently being fetched from the backend. */
    loading: boolean;
    /** Error message from failed history fetch attempts, displayed to the user. */
    error: string | null;
    /** Whether this row is currently expanded to show details. */
    isExpanded: boolean;
    /** Callback invoked when the user toggles the expansion state. */
    onToggle: () => void;
}

/**
 * Renders an expandable table row that displays detailed market information inline.
 *
 * This component replaces the previous slideout pattern with an inline dropdown approach.
 * When expanded, it displays market metadata, stats, trend chart, and comprehensive pricing
 * information in a collapsible row that appears directly below the market entry in the table.
 *
 * The component provides the same content as the previous MarketSlideout but in an inline
 * format that integrates better with the table structure and provides a more direct
 * interaction pattern.
 *
 * @param market - The market to display details for
 * @param history - Historical pricing data for rendering the trend chart
 * @param loading - Whether history data is being fetched (shows skeleton loader)
 * @param error - Error message from history fetch failures
 * @param isExpanded - Whether the details are currently visible
 * @param onToggle - Callback to toggle the expansion state
 * @returns A table row with expandable market details
 */
export function MarketDetailsRow({
    market,
    history,
    loading,
    error,
    isExpanded,
    onToggle
}: MarketDetailsRowProps) {
    /**
     * Determines the appropriate URL to link to for this market.
     * Prioritizes the affiliate/referral link if available, otherwise falls back to the first site link.
     * Returns null if no valid link is found.
     *
     * @returns The URL string to use for the market link, or null if no link is available
     */
    const marketUrl = useMemo(() => {
        // Priority 1: Affiliate/referral link
        if (market.affiliate?.link) {
            return market.affiliate.link;
        }

        // Priority 2: First site link
        if (market.siteLinks && market.siteLinks.length > 0 && market.siteLinks[0].link) {
            return market.siteLinks[0].link;
        }

        // No valid link found
        return null;
    }, [market.affiliate?.link, market.siteLinks]);

    /**
     * Maps platform names to lucide-react icon components.
     * Provides consistent icon representation for various social media platforms.
     *
     * @param platform - The platform name (e.g., "Twitter", "Telegram", "Discord")
     * @returns The appropriate lucide-react icon component for the platform
     */
    const getSocialIcon = (platform: string) => {
        const normalizedPlatform = platform.toLowerCase();

        if (normalizedPlatform.includes('twitter') || normalizedPlatform.includes('x')) {
            return Twitter;
        }
        if (normalizedPlatform.includes('telegram')) {
            return Send;
        }
        if (normalizedPlatform.includes('discord')) {
            return MessageCircle;
        }
        if (normalizedPlatform.includes('github')) {
            return Github;
        }
        if (normalizedPlatform.includes('youtube')) {
            return Youtube;
        }
        if (normalizedPlatform.includes('linkedin')) {
            return Linkedin;
        }
        if (normalizedPlatform.includes('facebook')) {
            return Facebook;
        }
        if (normalizedPlatform.includes('reddit')) {
            return MessageSquare;
        }

        // Default fallback
        return ExternalLink;
    };

    /**
     * Transforms historical market data into a format compatible with the LineChart component.
     * The backend pre-aggregates data into 6-hour buckets to reduce payload size from 4,320
     * raw records to ~120 aggregated buckets for 30-day queries. This provides a readable
     * trend view without overwhelming the chart with too many data points.
     *
     * Filters out invalid data points (null/undefined costs) to ensure the chart only
     * displays meaningful pricing trends without gaps or misleading data.
     *
     * @returns Chart series configuration with pre-aggregated data points from backend
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

        // Backend returns pre-aggregated data, just filter and transform
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

    // Only render when expanded
    if (!isExpanded) {
        return null;
    }

    return (
        <tr className={styles.details_row}>
            <td colSpan={6} className={styles.details_cell}>
                <div className={styles.details_container}>
                    {/* Two-column layout: Details on left, Pricing on right */}
                    <div className={styles.details_grid}>
                        {/* LEFT COLUMN: Details */}
                        <div className={styles.details_section}>
                                    <div className="stack" style={{ gap: '1.5rem' }}>
                                        {/* Market title and description */}
                                        <div>
                                            <div className={styles.title_row}>
                                                <div>
                                                    {marketUrl ? (
                                                        <h3 className={styles.section_title}>
                                                            <a
                                                                href={marketUrl}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className={styles.market_link}
                                                                aria-label={`Visit ${market.name} website`}
                                                            >
                                                                {market.name}
                                                                <ExternalLink size={16} className={styles.external_icon} />
                                                            </a>
                                                        </h3>
                                                    ) : (
                                                        <h3 className={styles.section_title}>{market.name}</h3>
                                                    )}
                                                </div>

                                                {market.social && market.social.length > 0 && (
                                                    <div className={styles.social_icons}>
                                                        {market.social.map((social, idx) => {
                                                            const Icon = getSocialIcon(social.platform);
                                                            return (
                                                                <a
                                                                    key={idx}
                                                                    href={social.link}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className={styles.social_icon}
                                                                    aria-label={`${market.name} on ${social.platform}`}
                                                                    title={social.label || social.platform}
                                                                >
                                                                    <Icon size={16} />
                                                                </a>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>

                                            <p className="text-subtle" style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                                                {market.description ?? 'Historical reliability and pricing trends for this marketplace.'}
                                            </p>

                                            {/* Badges row */}
                                            {(market.isBestDeal || market.bulkDiscount?.hasDiscount) && (
                                                <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    {market.isBestDeal && <Badge tone="success">Best deal</Badge>}
                                                    {market.bulkDiscount?.hasDiscount && <Badge tone="warning">Bulk discounts</Badge>}
                                                </div>
                                            )}
                                        </div>

                                        {/* Market stats: 4-card grid */}
                                        <section className={styles.stat_grid}>
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
                                                <div className="stat-card__delta">Last pricing data refresh</div>
                                            </Card>
                                        </section>

                                        {/* Trend chart */}
                                        <section>
                                            <h4 className={styles.subsection_title}>Cost per USDT TX trend</h4>
                                            {loading ? (
                                                <Skeleton style={{ height: '200px' }} />
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
                                                <div className="text-subtle" style={{ fontSize: '0.9rem' }}>No price history captured for this market yet.</div>
                                            )}
                                        </section>

                                        {error && <p className="text-subtle" style={{ fontSize: '0.9rem' }}>{error}</p>}

                                        {/* Bulk discount information */}
                                        {market.bulkDiscount?.hasDiscount && (
                                            <section className="surface surface--padding-sm" style={{ background: 'rgba(11, 16, 28, 0.6)', borderRadius: 'var(--radius-md)' }}>
                                                <h4 className={styles.subsection_title}>Bulk discount insights</h4>
                                                {market.bulkDiscount.summary && (
                                                    <p className="text-subtle" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>{market.bulkDiscount.summary}</p>
                                                )}
                                                {market.bulkDiscount.tiers && market.bulkDiscount.tiers.length > 0 ? (
                                                    <ul style={{ listStyle: 'none', padding: 0, margin: '0.75rem 0 0', display: 'grid', gap: '0.4rem' }}>
                                                        {[...market.bulkDiscount.tiers]
                                                            .sort((a, b) => a.minEnergy - b.minEnergy)
                                                            .map(tier => (
                                                                <li key={`${tier.minEnergy}-${tier.price}`} className="text-subtle" style={{ fontSize: '0.85rem' }}>
                                                                    {tier.minEnergy.toLocaleString()} energy ⇒ {tier.price.toFixed(2)} TRX ({tier.discountPercent.toFixed(1)}% off)
                                                                </li>
                                                            ))}
                                                    </ul>
                                                ) : (
                                                    <p className="text-subtle" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }}>Volume orders unlock better rates on this desk.</p>
                                                )}
                                            </section>
                                        )}
                                    </div>
                                </div>

                                {/* RIGHT COLUMN: Pricing */}
                                <div className={styles.pricing_section}>
                                    <div className="stack" style={{ gap: '1.5rem' }}>
                                        <div>
                                            <h3 className={styles.section_title}>Pricing Breakdown</h3>
                                            <p className="text-subtle" style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>
                                                Comprehensive pricing data across rental durations and energy amounts.
                                            </p>
                                        </div>

                                        {market.pricingDetail ? (
                                            <div style={{ display: 'grid', gap: '2rem' }}>
                                                {/* USDT Transfer Cost section */}
                                                {market.pricingDetail.usdtTransferCosts && market.pricingDetail.usdtTransferCosts.length > 0 && (
                                                    <section>
                                                        <h4 className={styles.subsection_title}>USDT Transfer Cost (65k energy)</h4>
                                                        <Card tone="muted" padding="sm">
                                                            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.85rem' }}>
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
                                                        <h4 className={styles.subsection_title}>Platform Pricing</h4>
                                                        <Card tone="muted" padding="sm">
                                                            <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.85rem' }}>
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
                                            <div className="text-subtle" style={{ fontSize: '0.9rem' }}>No detailed pricing data available for this market.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
            </td>
        </tr>
    );
}
