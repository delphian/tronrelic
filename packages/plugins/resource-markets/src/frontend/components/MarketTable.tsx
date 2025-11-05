'use client';

import { Fragment, useState, useMemo } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { MarketDocument } from '@tronrelic/shared';
import { Info } from 'lucide-react';
import { MarketDetailsRow } from './MarketDetailsRow';
import type { MarketHistoryRecord } from '../types';
import styles from './MarketTable.module.css';

interface MarketTableProps {
    context: IFrontendPluginContext;
    initialMarkets: MarketDocument[];
    expandedGuid?: string;
    history?: MarketHistoryRecord[];
    historyLoading?: boolean;
    historyError?: string | null;
    onToggleExpand?: (market: MarketDocument) => void;
}

/**
 * Displays a sortable table of energy rental markets with expandable inline details.
 *
 * This component renders the market leaderboard showing cost, availability, and metadata
 * for each tracked marketplace. When a market is clicked, it expands inline to show detailed
 * pricing information and historical data using MarketDetailsRow.
 *
 * @param context - Frontend plugin context providing UI components
 * @param initialMarkets - Server-side rendered markets used for initial display
 * @param expandedGuid - GUID of the currently expanded market
 * @param history - Historical pricing data for the expanded market
 * @param historyLoading - Whether history data is being fetched
 * @param historyError - Error message from history fetch failures
 * @param onToggleExpand - Callback invoked when a market row is clicked
 * @returns A card containing the market leaderboard table with expandable rows
 */
export function MarketTable({
    context,
    initialMarkets,
    expandedGuid,
    history = [],
    historyLoading = false,
    historyError = null,
    onToggleExpand
}: MarketTableProps) {
    const { ui } = context;
    const [isMounted, setIsMounted] = useState(false);

    // Sort markets by cost (lowest first), then by buy orders (highest first)
    const sortedMarkets = useMemo(() => {
        return [...initialMarkets].sort((a, b) => {
            const aCost = a.pricingDetail?.minUsdtTransferCost;
            const bCost = b.pricingDetail?.minUsdtTransferCost;
            const aOrders = a.orders?.length ?? 0;
            const bOrders = b.orders?.length ?? 0;

            const aHasCost = aCost !== undefined && aCost !== null && aCost > 0;
            const bHasCost = bCost !== undefined && bCost !== null && bCost > 0;

            if (aHasCost && bHasCost) {
                if (aCost !== bCost) return aCost - bCost;
                return bOrders - aOrders;
            }

            if (aHasCost) return -1;
            if (bHasCost) return 1;
            return bOrders - aOrders;
        });
    }, [initialMarkets]);

    return (
        <ui.Card className="market-table-container">
            <header className={styles.header}>
                <div className={styles.header__content}>
                    <h2 className={styles.header__title}>Energy Market Leaderboard</h2>
                    <p className={`text-subtle ${styles.header__description}`}>
                        Compare rental desks, availability, and reliability in real time.
                    </p>
                </div>
            </header>
            <div className={styles.table_scroll}>
                <table className="table">
                    <thead>
                        <tr>
                            <th className={styles.table__header_cell}>Market</th>
                            <th className={styles.table__header_cell}>
                                <ui.Tooltip
                                    content="Cost in TRX to send 1 USDT transfer (65k energy). Multi-day rentals divide cost across days, reducing per-transfer price."
                                    placement="bottom"
                                >
                                    <span className={styles.table__header_info}>
                                        TRX / USDT TX
                                        <Info size={14} className={styles.table__info_icon} />
                                    </span>
                                </ui.Tooltip>
                            </th>
                            <th className={styles.table__header_cell}>Price Range</th>
                            <th className={styles.table__header_cell}>Availability</th>
                            <th className={styles.table__header_cell}>Buy Orders</th>
                            <th className={styles.table__header_cell}>Updated</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sortedMarkets.map(market => {
                            const isExpanded = market.guid === expandedGuid;
                            const usdtTransferCost = market.pricingDetail?.minUsdtTransferCost
                                ? market.pricingDetail.minUsdtTransferCost.toFixed(3)
                                : '—';

                            return (
                                <Fragment key={market.guid}>
                                    <tr
                                        className={`${styles.table__row} ${isExpanded ? styles['table__row--expanded'] : ''}`}
                                        onClick={() => onToggleExpand?.(market)}
                                    >
                                        <td>
                                            <div className={styles.table__cell_market}>
                                                <strong className={styles.table__market_name}>{market.name}</strong>
                                                <span className={`text-subtle ${styles.table__market_region}`}>
                                                    {market.supportedRegions?.length
                                                        ? market.supportedRegions.join(', ')
                                                        : 'Global'}
                                                </span>
                                            </div>
                                        </td>
                                        <td>{usdtTransferCost}</td>
                                        <td>—</td>
                                        <td>
                                            {market.availabilityPercent != null && market.availabilityPercent > 0
                                                ? `${market.availabilityPercent.toFixed(1)}%`
                                                : '—'}
                                        </td>
                                        <td>{market.orders?.length ?? 0}</td>
                                        <td>
                                            <ui.ClientTime date={market.lastUpdated} format="time" />
                                        </td>
                                    </tr>
                                    <MarketDetailsRow
                                        context={context}
                                        market={market}
                                        history={isExpanded ? history : []}
                                        loading={isExpanded && historyLoading}
                                        error={isExpanded ? historyError : null}
                                        isExpanded={isExpanded}
                                        onToggle={() => onToggleExpand?.(market)}
                                    />
                                </Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </ui.Card>
    );
}
