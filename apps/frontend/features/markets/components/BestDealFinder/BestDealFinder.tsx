'use client';

import { useMemo, useState } from 'react';
import type { MarketDocument } from '@tronrelic/shared';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { cn } from '../../../../lib/cn';
import styles from './BestDealFinder.module.css';

/**
 * Properties for the BestDealFinder component.
 */
interface BestDealFinderProps {
    /** Array of market documents to filter and sort */
    markets: MarketDocument[];
    /** Callback when a market card is clicked */
    onSelect?: (market: MarketDocument) => void;
}

/**
 * Available sorting criteria for market comparison.
 */
type SortKey = 'price' | 'reliability' | 'availability';

/**
 * BestDealFinder - Market comparison tool with dynamic sorting and filtering
 *
 * Helps users identify the most efficient TRON energy rental desks by:
 * - **Price** - Lowest effective price per unit of energy
 * - **Reliability** - Historical uptime and fulfillment rate
 * - **Availability** - Current energy inventory availability
 *
 * Features:
 * - Real-time search filtering by market name
 * - Three-way sorting with visual button toggles
 * - Top 6 results displayed in responsive grid
 * - "Featured" badge for best deal markets
 * - Click-to-select interaction for market details
 *
 * Only active markets are shown in results. Markets without metrics
 * (null values) are sorted to the end of their respective sort order.
 *
 * @param props - Component properties with markets array and selection callback
 * @returns A card containing search, sort controls, and market grid
 */
export function BestDealFinder({ markets, onSelect }: BestDealFinderProps) {
    const [sortKey, setSortKey] = useState<SortKey>('price');
    const [search, setSearch] = useState('');

    /**
     * Filters, sorts, and limits markets based on current search and sort criteria.
     *
     * Processing pipeline:
     * 1. Filter to active markets only
     * 2. Apply search filter (case-insensitive name match)
     * 3. Sort by selected metric (price/reliability/availability)
     * 4. Take top 6 results
     *
     * Memoized to prevent recalculation on unrelated re-renders.
     */
    const shortlist = useMemo(() => {
        const normalized = markets.filter(market => market.isActive);
        const filtered = search
            ? normalized.filter(market => market.name.toLowerCase().includes(search.toLowerCase()))
            : normalized;

        const sorted = [...filtered].sort((a, b) => {
            switch (sortKey) {
                case 'reliability':
                    return (b.reliability ?? 0) - (a.reliability ?? 0);
                case 'availability':
                    return (b.availabilityPercent ?? 0) - (a.availabilityPercent ?? 0);
                default:
                    return (a.effectivePrice ?? Number.POSITIVE_INFINITY) - (b.effectivePrice ?? Number.POSITIVE_INFINITY);
            }
        });

        return sorted.slice(0, 6);
    }, [markets, search, sortKey]);

    return (
        <Card>
            <div className="stack">
                <header className={styles.header}>
                    <div className={styles.header__row}>
                        <div>
                            <h2 className={styles.header__title}>Find the best deal</h2>
                            <p className={styles.header__description}>
                                Surface the most efficient rental desks by price, reliability, or availability.
                            </p>
                        </div>
                        <div className={styles['sort-buttons']}>
                            <Button
                                variant={sortKey === 'price' ? 'primary' : 'ghost'}
                                size="sm"
                                onClick={() => setSortKey('price')}
                            >
                                Price
                            </Button>
                            <Button
                                variant={sortKey === 'reliability' ? 'primary' : 'ghost'}
                                size="sm"
                                onClick={() => setSortKey('reliability')}
                            >
                                Reliability
                            </Button>
                            <Button
                                variant={sortKey === 'availability' ? 'primary' : 'ghost'}
                                size="sm"
                                onClick={() => setSortKey('availability')}
                            >
                                Availability
                            </Button>
                        </div>
                    </div>
                    <Input
                        placeholder="Search markets"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                        variant="ghost"
                    />
                </header>

                <section className={styles['markets-grid']}>
                    {shortlist.map(market => (
                        <article
                            key={market.guid}
                            className={cn(
                                styles['market-card'],
                                onSelect && styles['market-card--clickable']
                            )}
                            onClick={() => onSelect?.(market)}
                        >
                            <div className={styles['market-card__header']}>
                                <div className={styles['market-card__info']}>
                                    <div className={styles['market-card__name']}>{market.name}</div>
                                    <div className={styles['market-card__region']}>
                                        {market.supportedRegions?.join(', ') ?? 'Global'}
                                    </div>
                                </div>
                                {market.isBestDeal && <Badge tone="success">Featured</Badge>}
                            </div>
                            <ul className={styles['market-card__metrics']}>
                                <li>
                                    Effective price: {market.effectivePrice != null ? `${market.effectivePrice.toFixed(2)} TRX` : '—'}
                                </li>
                                <li>
                                    Availability: {market.availabilityPercent != null ? `${market.availabilityPercent.toFixed(1)}%` : '—'}
                                </li>
                                <li>
                                    Reliability: {market.reliability != null ? `${Math.round(market.reliability * 100)}%` : '—'}
                                </li>
                            </ul>
                        </article>
                    ))}
                    {!shortlist.length && (
                        <div className={styles['empty-state']}>No markets match your filters at the moment.</div>
                    )}
                </section>
            </div>
        </Card>
    );
}
