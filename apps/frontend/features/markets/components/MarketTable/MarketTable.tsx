'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarketDocument } from '@tronrelic/shared';
import { Info } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '../../../../store/hooks';
import { setMarkets } from '../../slice';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { cn } from '../../../../lib/cn';
import { useRealtimeStatus } from '../../../realtime/hooks/useRealtimeStatus';
import { useSocketSubscription } from '../../../realtime/hooks/useSocketSubscription';
import styles from './MarketTable.module.css';

interface MarketTableProps {
  initialMarkets: MarketDocument[];
  selectedGuid?: string;
  onSelect?: (market: MarketDocument) => void;
}

/**
 * Displays a sortable table of energy rental markets with real-time pricing updates.
 *
 * This component renders the market leaderboard, showing cost, availability, and metadata for
 * each tracked marketplace. It subscribes to real-time market updates via Socket.IO and highlights
 * rows when new data arrives. When a market is clicked, it triggers the parent's onSelect callback
 * to open the slideout panel with detailed information.
 *
 * @param initialMarkets - Server-side rendered markets used for initial hydration
 * @param selectedGuid - GUID of the currently selected market (highlights the row)
 * @param onSelect - Callback invoked when a market row is clicked
 * @returns A card containing the market leaderboard table
 */
export function MarketTable({ initialMarkets, selectedGuid, onSelect }: MarketTableProps) {
  const dispatch = useAppDispatch();
  const markets = useAppSelector(state => state.markets.markets);
  const realtime = useRealtimeStatus();
  const [highlightGuid, setHighlightGuid] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const hydratedRef = useRef(false);

  const subscription = useMemo(() => ({ markets: { all: true } }), []);
  useSocketSubscription(subscription, { immediate: false });

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (initialMarkets.length) {
      dispatch(setMarkets(initialMarkets));
    }
  }, [dispatch, initialMarkets]);

  const leadingGuid = markets[0]?.guid;

  useEffect(() => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      return;
    }

    if (!leadingGuid) {
      return;
    }

    setHighlightGuid(leadingGuid);
    const timer = window.setTimeout(() => {
      setHighlightGuid(current => (current === leadingGuid ? null : current));
    }, 3200);

    return () => {
      window.clearTimeout(timer);
    };
  }, [leadingGuid]);

  const bestDealGuid = useMemo(() => markets.find(market => market.isBestDeal)?.guid, [markets]);

  // Sort markets by TRX per USDT transfer (lowest first), then by buy orders (highest first)
  // Markets with no data go to the end
  const sortedMarkets = useMemo(() => {
    return [...markets].sort((a, b) => {
      const aCost = a.pricingDetail?.minUsdtTransferCost;
      const bCost = b.pricingDetail?.minUsdtTransferCost;
      const aOrders = a.orders?.length ?? 0;
      const bOrders = b.orders?.length ?? 0;

      // Check if costs are valid numbers (not undefined, not null, not 0)
      const aHasCost = aCost !== undefined && aCost !== null && aCost > 0;
      const bHasCost = bCost !== undefined && bCost !== null && bCost > 0;

      // If both have costs, sort by cost (lowest first)
      if (aHasCost && bHasCost) {
        if (aCost !== bCost) {
          return aCost - bCost;
        }
        // If costs are equal, sort by orders (highest first)
        return bOrders - aOrders;
      }

      // Markets with cost data come before those without
      if (aHasCost) return -1;
      if (bHasCost) return 1;

      // Both have no cost data, sort by orders (highest first)
      return bOrders - aOrders;
    });
  }, [markets]);

  return (
    <Card className="market-table-container">
      <header className={styles.header}>
        <div className={styles.header__content}>
          <h2 className={styles.header__title}>Energy Market Leaderboard</h2>
          <p className={`text-subtle ${styles.header__description}`}>Compare rental desks, availability, and reliability in real time.</p>
        </div>
        {isMounted && (
          <div className={styles.header__status}>
            <Badge tone={realtime.tone} aria-live="polite" suppressHydrationWarning>
              <span suppressHydrationWarning>{realtime.label}</span>
              {realtime.latencyMs !== null && (
                <span className={styles.latency} suppressHydrationWarning>
                  {Math.round(realtime.latencyMs)} ms
                </span>
              )}
            </Badge>
          </div>
        )}
      </header>
      <div className={styles.table_scroll}>
        <table className="table">
          <thead>
            <tr>
              <th className={styles.table__header_cell}>Market</th>
              <th className={styles.table__header_cell}>
                <span className={styles.table__header_info}>
                  TRX per USDT TX
                  <span title="Cost in TRX to send 1 USDT transfer (65k energy). Multi-day rentals divide cost across days, reducing per-transfer price.">
                    <Info
                      size={14}
                      className={styles.table__info_icon}
                      aria-label="Cost in TRX to send 1 USDT transfer (65k energy). Multi-day rentals divide cost across days, reducing per-transfer price."
                    />
                  </span>
                </span>
              </th>
              <th className={styles.table__header_cell}>Price Range</th>
              <th className={`${styles.table__header_cell} ${styles.col_availability} table-col-availability`}>Availability</th>
              <th className={styles.table__header_cell}>Buy Orders</th>
              <th className={`${styles.table__header_cell} ${styles.col_updated} table-col-updated`}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {sortedMarkets.map(market => {
              const isBestDeal = market.guid === bestDealGuid;
              const isSelected = market.guid === selectedGuid;
              const isHighlighted = market.guid === highlightGuid;

              /**
               * Calculates and formats the price range display for a market.
               * Shows the lowest and highest cost per USDT transfer across all available rental durations.
               * This gives users a quick overview of pricing tiers without expanding the full details.
               */
              const priceRange = market.pricingDetail?.usdtTransferCosts && market.pricingDetail.usdtTransferCosts.length > 0
                ? (() => {
                    // Sort by duration (shortest first), then by price (lowest first)
                    const sorted = [...market.pricingDetail.usdtTransferCosts].sort((a, b) => {
                      if (a.durationMinutes !== b.durationMinutes) {
                        return a.durationMinutes - b.durationMinutes;
                      }
                      return a.costTrx - b.costTrx;
                    });

                    // Find lowest and highest price per transfer
                    const lowestCost = sorted.reduce((min, c) => c.costTrx < min.costTrx ? c : min, sorted[0]);
                    const highestCost = sorted.reduce((max, c) => c.costTrx > max.costTrx ? c : max, sorted[0]);

                    const formatDuration = (minutes: number) => {
                      const hours = Math.floor(minutes / 60);
                      const days = Math.floor(hours / 24);
                      return days > 0 ? `${days}d` : hours > 0 ? `${hours}h` : `${minutes}m`;
                    };

                    const line1 = `${lowestCost.costTrx.toFixed(2)} TRX/tx @ ${formatDuration(lowestCost.durationMinutes)}`;
                    const line2 = `${highestCost.costTrx.toFixed(2)} TRX/tx @ ${formatDuration(highestCost.durationMinutes)}`;

                    return (
                      <div className={styles.table__price_range}>
                        <div key="lowest">{line1}</div>
                        <div key="highest" className={styles.table__price_range_high}>{line2}</div>
                      </div>
                    );
                  })()
                : '—';

              // Format USDT transfer cost in TRX with 3 decimal places
              const usdtTransferCost = market.pricingDetail?.minUsdtTransferCost
                ? market.pricingDetail.minUsdtTransferCost.toFixed(3)
                : '—';

              const rowClassName = cn(
                styles.table__row,
                isHighlighted && 'table-row--flash',
                isSelected && styles['table__row--selected'],
                isBestDeal && !isSelected && styles['table__row--best_deal']
              );

              return (
                <tr
                  key={market.guid}
                  className={rowClassName}
                  onClick={() => onSelect?.(market)}
                >
                  <td>
                    <div className={styles.table__cell_market}>
                      <strong className={styles.table__market_name}>{market.name}</strong>
                      <span className={`text-subtle ${styles.table__market_region}`}>
                        {market.supportedRegions?.length ? market.supportedRegions.join(', ') : 'Global'}
                      </span>
                    </div>
                  </td>
                  <td>{usdtTransferCost}</td>
                  <td>{priceRange}</td>
                  <td className={`${styles.col_availability} table-col-availability`}>{market.availabilityPercent != null && market.availabilityPercent > 0 ? `${market.availabilityPercent.toFixed(1)}%` : '—'}</td>
                  <td>{market.orders?.length ?? 0}</td>
                  <td className={`${styles.col_updated} table-col-updated`}>{new Date(market.lastUpdated).toLocaleTimeString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
