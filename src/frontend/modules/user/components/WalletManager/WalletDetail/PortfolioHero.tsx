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

import { useMemo, useState } from 'react';
import type { IPortfolioSummary } from '@/types';
import { Wallet, TrendingUp, TrendingDown, Hourglass, Coins } from 'lucide-react';
import { LineChart, DonutChart, type DonutSlice } from '../../../../../features/charts';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Stack } from '../../../../../components/layout';
import { WalletDetailSection, StatTile } from './WalletDetailPrimitives';
import { truncateAddress } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/**
 * Which asset the balance-over-time chart plots. Only TRX is populated today —
 * the backend `balanceSeriesUsd` reconstructs the TRX balance alone — so the
 * selector is explicit rather than implying the curve is full net worth. The
 * union and {@link BALANCE_DENOMINATIONS} extend when per-token or aggregate
 * ("all") series are added.
 */
type BalanceDenomination = 'trx';

/** Selectable denominations for the balance-over-time chart, in display order. */
const BALANCE_DENOMINATIONS: ReadonlyArray<{ id: BalanceDenomination; label: string }> = [{ id: 'trx', label: 'TRX' }];

/** Locale-independent month abbreviations, for hydration-safe date labels (UTC). */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Format a daily point's Date as `MMM D` for the x-axis. Uses UTC fields and a
 * fixed name table so the label is identical on server and client (no
 * locale/timezone drift) — the same hydration-safe approach the flow chart uses,
 * replacing the bare numeric `M/D` so the axis reads as a date.
 *
 * @param date - The point's day (parsed UTC by the chart).
 * @returns The `MMM D` axis label.
 */
function formatAxisDay(date: Date): string {
    return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Format a daily point's Date as `MMM D, YYYY` for the tooltip heading, giving
 * the absolute date (with year) the compact axis label omits. UTC-based for the
 * same hydration safety as {@link formatAxisDay}.
 *
 * @param date - The hovered point's day.
 * @returns The `MMM D, YYYY` tooltip heading.
 */
function formatTooltipDay(date: Date): string {
    return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

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
    // Hooks run before the snapshot-pending early return so their call order stays
    // stable across renders (React's rules-of-hooks).
    const [denomination, setDenomination] = useState<BalanceDenomination>('trx');

    // The balance-over-time series. Only TRX is sourced today — the backend
    // reconstructs the TRX balance alone — so the chart is honestly a TRX curve,
    // not full net worth. Structured so a future per-token or "all" aggregate
    // slots in by sourcing its own points under another denomination here.
    const balanceSeries = useMemo(
        () => {
            const points = denomination === 'trx' ? summary.balanceSeriesUsd : [];
            return [
                {
                    id: 'balance',
                    label: denomination.toUpperCase(),
                    color: 'var(--chart-color-total)',
                    fill: true,
                    data: points.map((point) => ({ date: point.day, value: point.valueUsd }))
                }
            ];
        },
        [summary, denomination]
    );

    // No snapshot has been captured yet for this scope. Holdings and net worth are
    // derived solely from the balance snapshot, so without one every figure would
    // read $0 / "No holdings" — indistinguishable from a wallet that genuinely
    // holds nothing. `capturedAt === null` is the unambiguous "snapshot pending"
    // signal (it arrives as JSON null, never a Date), so we show a friendly
    // preparing state instead of misleading zeros. Once the first snapshot tick
    // runs, capturedAt becomes a date and the real hero renders.
    if (summary.capturedAt === null) {
        return (
            <WalletDetailSection
                icon={<Wallet size={16} aria-hidden style={{ color: 'var(--color-primary)' }} />}
                title="Portfolio"
            >
                <div className={styles.portfolio_pending}>
                    <span className={styles.portfolio_pending_title}>
                        <Hourglass size={16} aria-hidden style={{ color: 'var(--color-primary)' }} />
                        Preparing your portfolio
                    </span>
                    <p className="text-muted">
                        We&rsquo;re capturing your current balances. Net worth and holdings appear
                        here once the first snapshot completes &mdash; usually within a few hours.
                    </p>
                </div>
            </WalletDetailSection>
        );
    }

    const pnlPositive = summary.totalPnlUsd >= 0;
    const slices: DonutSlice[] = summary.allocation.map((entry) => ({ label: entry.symbol, value: entry.valueUsd }));

    // Denomination switch placed in the chart header (mirrors the flow chart). One
    // option today; makes the TRX-only scope explicit and reserves the slot.
    const denominationToggle = (
        <span className={styles.flow_toggle}>
            {BALANCE_DENOMINATIONS.map((option) => (
                <Button
                    key={option.id}
                    variant={denomination === option.id ? 'secondary' : 'ghost'}
                    size="xs"
                    aria-pressed={denomination === option.id}
                    onClick={() => setDenomination(option.id)}
                >
                    {option.label}
                </Button>
            ))}
        </span>
    );

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
                        series={balanceSeries}
                        title="Net worth over time"
                        actions={denominationToggle}
                        height={220}
                        yAxisFormatter={(value) => formatUsd(value)}
                        xAxisFormatter={formatAxisDay}
                        tooltipDateFormatter={formatTooltipDay}
                        emptyLabel="Building balance history…"
                    />
                    <p className="text-muted">
                        <Coins size={14} aria-hidden /> Balance over time currently reflects TRX holdings only — token balances are not yet included.
                    </p>
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
