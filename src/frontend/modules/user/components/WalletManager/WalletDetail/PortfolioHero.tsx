'use client';

/**
 * @fileoverview Presentational portfolio hero — the valuation surface that fills
 * the seam reserved at the top of the wallet detail view.
 *
 * Renders one {@link IPortfolioSummary} at either scope (a single wallet or the
 * user's whole set) with the identical layout, because the summary shape is
 * scope-agnostic by design. Pure presentation: it receives a fully-computed
 * summary and draws net worth, PnL, an allocation donut, a holdings table, and
 * the USD balance-over-time line — no fetching, no business logic.
 */

import type { IPortfolioSummary } from '@/types';
import { Wallet, TrendingUp, TrendingDown } from 'lucide-react';
import { LineChart, DonutChart, type DonutSlice } from '../../../../../features/charts';
import { Card } from '../../../../../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Stack } from '../../../../../components/layout';
import { WalletDetailSection, StatTile } from './WalletDetailPrimitives';
import { truncateAddress } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/**
 * Props for {@link PortfolioHero}.
 */
interface IPortfolioHeroProps {
    /** The computed portfolio summary to render. */
    summary: IPortfolioSummary;
}

/**
 * Format a USD amount for display, compacting large magnitudes.
 *
 * @param value - USD amount.
 * @param signed - When true, prefixes a `+` for non-negative values (for PnL).
 * @returns A formatted USD string.
 */
function formatUsd(value: number, signed = false): string {
    const sign = signed && value >= 0 ? '+' : value < 0 ? '-' : '';
    const abs = Math.abs(value);
    const body = abs >= 1000
        ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : abs.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return `${sign}$${body}`;
}

/**
 * Format a token quantity, trimming to a readable precision.
 *
 * @param value - Quantity in human units.
 * @returns A formatted quantity string.
 */
function formatQty(value: number): string {
    return value.toLocaleString('en-US', { maximumFractionDigits: value >= 1 ? 2 : 6 });
}

/**
 * Render the full portfolio hero for one scope.
 *
 * @param props - {@link IPortfolioHeroProps}.
 * @returns The hero section.
 */
export function PortfolioHero({ summary }: IPortfolioHeroProps) {
    const pnlPositive = summary.totalPnlUsd >= 0;
    const slices: DonutSlice[] = summary.allocation.map((entry) => ({ label: entry.symbol, value: entry.valueUsd }));
    const series = [
        {
            id: 'networth',
            label: 'Net worth',
            color: 'var(--chart-color-total)',
            fill: true,
            data: summary.balanceSeriesUsd.map((point) => ({ date: point.day, value: point.valueUsd }))
        }
    ];

    return (
        <WalletDetailSection
            icon={<Wallet size={16} aria-hidden style={{ color: 'var(--color-primary)' }} />}
            title="Portfolio"
        >
            <Stack gap="md">
                <div className="stat-grid">
                    <StatTile label="Net worth" value={formatUsd(summary.netWorthUsd)} icon={<Wallet size={14} aria-hidden />} />
                    <StatTile
                        label="Total PnL"
                        value={<span style={{ color: pnlPositive ? 'var(--color-success)' : 'var(--color-danger)' }}>{formatUsd(summary.totalPnlUsd, true)}</span>}
                        icon={pnlPositive ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
                    />
                    <StatTile label="Realized" value={formatUsd(summary.realizedPnlUsd, true)} />
                    <StatTile label="Unrealized" value={formatUsd(summary.unrealizedPnlUsd, true)} />
                </div>

                <div className={styles.portfolio_split}>
                    <Card padding="md" className={styles.portfolio_donut}>
                        <DonutChart
                            slices={slices}
                            centerLabel={formatUsd(summary.netWorthUsd)}
                            centerCaption="Net worth"
                            emptyLabel="No priced holdings"
                        />
                    </Card>
                    <Card padding="md" className={styles.portfolio_holdings}>
                        <Table variant="compact">
                            <Thead>
                                <Tr>
                                    <Th>Asset</Th>
                                    <Th align="right">Quantity</Th>
                                    <Th align="right">Value</Th>
                                    <Th align="right">Unrealized</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {summary.holdings.length === 0 ? (
                                    <Tr>
                                        <Td colSpan={4}><span className="text-muted">No holdings yet.</span></Td>
                                    </Tr>
                                ) : (
                                    summary.holdings.map((holding) => (
                                        <Tr key={holding.asset}>
                                            <Td>{holding.symbol}</Td>
                                            <Td align="right">{formatQty(holding.quantity)}</Td>
                                            <Td align="right">{holding.priceUsd === null ? '—' : formatUsd(holding.valueUsd)}</Td>
                                            <Td align="right">
                                                {holding.priceUsd === null ? (
                                                    <span className="text-muted">unpriced</span>
                                                ) : (
                                                    <span style={{ color: holding.unrealizedPnlUsd >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                                        {formatUsd(holding.unrealizedPnlUsd, true)}
                                                    </span>
                                                )}
                                            </Td>
                                        </Tr>
                                    ))
                                )}
                            </Tbody>
                        </Table>
                    </Card>
                </div>

                <Card padding="md">
                    <LineChart
                        series={series}
                        title="Net worth over time"
                        height={220}
                        yAxisFormatter={(value) => formatUsd(value)}
                        xAxisFormatter={(date) => `${date.getUTCMonth() + 1}/${date.getUTCDate()}`}
                        emptyLabel="Building balance history…"
                    />
                </Card>

                {summary.unpricedAssets.length > 0 && (
                    <p className="text-muted">
                        {summary.unpricedAssets.length} held asset{summary.unpricedAssets.length === 1 ? '' : 's'} with no local price, excluded from USD totals
                        {summary.unpricedAssets.length <= 3 ? ` (${summary.unpricedAssets.map(truncateAddress).join(', ')})` : ''}.
                    </p>
                )}
            </Stack>
        </WalletDetailSection>
    );
}
