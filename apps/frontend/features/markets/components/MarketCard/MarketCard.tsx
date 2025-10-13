'use client';

import type { MarketDocument } from '@tronrelic/shared';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { AffiliateLink } from '../AffiliateLink';
import styles from './MarketCard.module.css';

/**
 * MarketCard Component
 *
 * Displays comprehensive information about an energy marketplace including pricing,
 * availability, reliability metrics, bulk discounts, and affiliate links.
 *
 * This component demonstrates the CSS Modules pattern:
 * - Component-specific styles are in MarketCard.module.css
 * - Utility classes (.stack, .text-subtle) from globals.css are still used
 * - Design tokens (CSS variables) ensure visual consistency
 *
 * @param market - The market data to display
 * @param onSelect - Optional callback when the card is clicked
 */
interface MarketCardProps {
    market: MarketDocument;
    onSelect?: (market: MarketDocument) => void;
}

export function MarketCard({ market, onSelect }: MarketCardProps) {
    const confidencePercent = market.availabilityConfidence != null
        ? Math.round(market.availabilityConfidence * 100)
        : null;

    const bulkDiscountTiers = market.bulkDiscount?.tiers?.length
        ? [...market.bulkDiscount.tiers].sort((a, b) => a.minEnergy - b.minEnergy)
        : [];

    return (
        <Card
            tone="muted"
            style={{ cursor: onSelect ? 'pointer' : 'default', containerType: 'inline-size' }}
            onClick={() => onSelect?.(market)}
        >
            <div className="stack stack--sm">
                <header className={styles.header}>
                    <div>
                        <h3 className={styles.header__title}>{market.name}</h3>
                        {market.description && (
                            <p className={`text-subtle ${styles.header__description}`}>
                                {market.description}
                            </p>
                        )}
                    </div>
                    <div className={styles.header__badges}>
                        {market.isBestDeal && <Badge tone="success">Best deal</Badge>}
                        {market.reliability && market.reliability >= 0.98 && (
                            <Badge tone="neutral">High reliability</Badge>
                        )}
                        {confidencePercent !== null && (
                            <Badge tone={confidenceTone(market.availabilityConfidence)}>
                                Confidence {confidencePercent}%
                            </Badge>
                        )}
                        {market.bulkDiscount?.hasDiscount && (
                            <Badge tone="warning">Bulk discounts</Badge>
                        )}
                        {!market.isActive && <Badge tone="danger">Offline</Badge>}
                    </div>
                </header>

                <section className={styles.metrics}>
                    <Metric
                        label="Effective price"
                        value={
                            market.effectivePrice != null
                                ? `${market.effectivePrice.toFixed(2)} TRX`
                                : '—'
                        }
                    />
                    <Metric
                        label="Availability"
                        value={
                            market.availabilityPercent != null
                                ? `${market.availabilityPercent.toFixed(1)}%`
                                : '—'
                        }
                    />
                    <Metric
                        label="Reliability"
                        value={
                            market.reliability != null
                                ? `${Math.round(market.reliability * 100)}%`
                                : '—'
                        }
                    />
                    <Metric
                        label="Avg. delivery"
                        value={
                            market.averageDeliveryTime != null
                                ? `${market.averageDeliveryTime.toFixed(1)} min`
                                : '—'
                        }
                    />
                    <Metric
                        label="Confidence"
                        value={confidencePercent !== null ? `${confidencePercent}%` : '—'}
                    />
                </section>

                {market.energy && (
                    <section className={styles.section}>
                        <h4 className={styles.section__title}>Energy inventory</h4>
                        <ul className={styles.section__list}>
                            <li className={`text-subtle ${styles.section__list_item}`}>
                                Total: {market.energy.total.toLocaleString()} units
                            </li>
                            <li className={`text-subtle ${styles.section__list_item}`}>
                                Available: {market.energy.available.toLocaleString()} units
                            </li>
                            {market.energy.price != null && (
                                <li className={`text-subtle ${styles.section__list_item}`}>
                                    Price: {market.energy.price} {market.energy.unit ?? 'TRX'}
                                </li>
                            )}
                            {market.energy.minOrder != null && (
                                <li className={`text-subtle ${styles.section__list_item}`}>
                                    Min order: {market.energy.minOrder.toLocaleString()}
                                </li>
                            )}
                            {market.energy.maxOrder != null && (
                                <li className={`text-subtle ${styles.section__list_item}`}>
                                    Max order: {market.energy.maxOrder.toLocaleString()}
                                </li>
                            )}
                        </ul>
                    </section>
                )}

                {market.bulkDiscount?.hasDiscount && (
                    <section className={`${styles.section} ${styles['section--secondary']}`}>
                        <h4 className={styles.section__title}>Bulk discount insights</h4>
                        {market.bulkDiscount.summary && (
                            <p className={`text-subtle ${styles.section__description}`}>
                                {market.bulkDiscount.summary}
                            </p>
                        )}
                        {bulkDiscountTiers.length ? (
                            <ul className={styles.section__list}>
                                {bulkDiscountTiers.map(tier => (
                                    <li
                                        key={`${tier.minEnergy}-${tier.price}`}
                                        className={`text-subtle ${styles.section__list_item}`}
                                    >
                                        {tier.minEnergy.toLocaleString()} energy ⇒{' '}
                                        {tier.price.toFixed(2)} TRX ({tier.discountPercent.toFixed(1)}
                                        % off)
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className={`text-subtle ${styles.section__description}`}>
                                Higher order sizes unlock meaningful savings.
                            </p>
                        )}
                    </section>
                )}

                {market.siteLinks?.length ? (
                    <footer className={styles.footer}>
                        {market.siteLinks.map(link => (
                            <AffiliateLink
                                key={link.link}
                                market={market}
                                link={link}
                                className="chip"
                            >
                                {link.text ?? 'Visit site'}
                            </AffiliateLink>
                        ))}
                    </footer>
                ) : null}
            </div>
        </Card>
    );
}

/**
 * Metric Display Component
 *
 * Displays a labeled metric value with consistent styling.
 *
 * @param label - The metric label (e.g., "Effective price")
 * @param value - The metric value (e.g., "12.50 TRX")
 */
function Metric({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div className={styles.metric__label}>{label}</div>
            <strong className={styles.metric__value}>{value}</strong>
        </div>
    );
}

/**
 * Determines the badge tone based on confidence level
 *
 * Confidence levels:
 * - >= 85%: Success (high confidence)
 * - >= 60%: Warning (medium confidence)
 * - < 60%: Danger (low confidence)
 *
 * @param confidence - The confidence value (0-1 scale)
 * @returns The appropriate badge tone
 */
function confidenceTone(confidence?: number | null) {
    if (confidence == null) {
        return 'neutral' as const;
    }
    if (confidence >= 0.85) {
        return 'success' as const;
    }
    if (confidence >= 0.6) {
        return 'warning' as const;
    }
    return 'danger' as const;
}
