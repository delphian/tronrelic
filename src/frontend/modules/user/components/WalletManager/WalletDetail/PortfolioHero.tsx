'use client';

/**
 * @fileoverview Presentational portfolio hero — the money-first surface of the
 * Wallets tab.
 *
 * Net worth is the single number a portfolio user wants, so it leads at hero
 * size with PnL beside it; the number carries a directional arrow AND a signed
 * value so gain/loss never relies on colour alone (≈8% of men are red/green
 * colour-blind). Realized and unrealized PnL are labelled separately because
 * they mean different things (realized is taxable, unrealized is not). The
 * balance chart carries a 1M/3M/1Y/All range selector that filters the returned
 * series client-side — an honest zoom over data actually present, not a
 * fabricated live range. The series itself defaults to a trailing year and
 * only reaches further back when an admin has widened that specific wallet to
 * unbounded, so "All" is not always longer than "1Y" — it is whatever the
 * backend actually returned. A warning banner appears under the chart when
 * `summary.historyBackfillComplete` is false, since an in-progress ledger
 * backfill can shift the reconstructed curve, not just shorten it. Pure
 * presentation: it receives a fully-computed {@link IPortfolioSummary} and
 * renders it identically at either scope.
 */

import { useMemo, useState } from 'react';
import type { IPortfolioSummary, IPortfolioBalancePoint } from '@/types';
import { Wallet, TrendingUp, TrendingDown, Hourglass, Coins } from 'lucide-react';
import { LineChart, DonutChart, type DonutSlice } from '../../../../../features/charts';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Stack } from '../../../../../components/layout';
import { WalletDetailSection } from './WalletDetailPrimitives';
import { truncateAddress } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/** A selectable window over the balance series. `days === null` means the full series. */
interface IBalanceRange {
    /** Stable id used for the active-state comparison. */
    id: string;
    /** Short button label. */
    label: string;
    /** Trailing window in days, or null for the whole returned series. */
    days: number | null;
}

/**
 * Selectable ranges for the balance-over-time chart. These are honest
 * client-side zooms over whatever series the backend returned — a trailing
 * year by default, or the wallet's full reconstructable history once an admin
 * widens it — never a claim of finer or live resolution.
 */
const BALANCE_RANGES: ReadonlyArray<IBalanceRange> = [
    { id: '1m', label: '1M', days: 30 },
    { id: '3m', label: '3M', days: 90 },
    { id: '1y', label: '1Y', days: 365 },
    { id: 'all', label: 'All', days: null }
];

/** Locale-independent month abbreviations, for hydration-safe date labels (UTC). */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Shift a `YYYY-MM-DD` day by a number of days, using UTC so the result is
 * identical on server and client (no timezone drift). Used to compute the
 * range-selector cutoff from the series' newest day.
 *
 * @param day - The base day as `YYYY-MM-DD`.
 * @param deltaDays - Days to add (negative to go back).
 * @returns The shifted day as `YYYY-MM-DD`.
 */
function shiftDay(day: string, deltaDays: number): string {
    const [year, month, date] = day.split('-').map(Number);
    const shifted = new Date(Date.UTC(year, month - 1, date));
    shifted.setUTCDate(shifted.getUTCDate() + deltaDays);
    return shifted.toISOString().slice(0, 10);
}

/**
 * Filter the balance series to a trailing window measured from its newest point.
 * ISO `YYYY-MM-DD` strings compare lexicographically, so a string compare against
 * the cutoff is correct and avoids per-point Date parsing.
 *
 * @param points - The full balance series, oldest first.
 * @param days - Trailing window in days, or null for the whole series.
 * @returns The points within the window.
 */
function filterByRange(points: IPortfolioBalancePoint[], days: number | null): IPortfolioBalancePoint[] {
    if (days === null || points.length === 0) {
        return points;
    }
    const cutoff = shiftDay(points[points.length - 1].day, -days);
    return points.filter((point) => point.day >= cutoff);
}

/**
 * Format a daily point's Date as `MMM D` for the x-axis. Uses UTC fields and a
 * fixed name table so the label is identical on server and client.
 *
 * @param date - The point's day (parsed UTC by the chart).
 * @returns The `MMM D` axis label.
 */
function formatAxisDay(date: Date): string {
    return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * Format a daily point's Date as `MMM D, YYYY` for the tooltip heading, giving
 * the absolute date the compact axis label omits. UTC-based for hydration safety.
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
    const [rangeId, setRangeId] = useState<string>('3m');

    // The balance series clipped to the active range. Only TRX is sourced today —
    // the backend reconstructs the TRX balance alone — so the caption stays honest
    // about scope; the range only zooms the window.
    const balanceSeries = useMemo(
        () => {
            const range = BALANCE_RANGES.find((option) => option.id === rangeId) ?? BALANCE_RANGES[0];
            const points = filterByRange(summary.balanceSeriesUsd, range.days);
            return [
                {
                    id: 'balance',
                    label: 'TRX',
                    color: 'var(--chart-color-total)',
                    fill: true,
                    data: points.map((point) => ({ date: point.day, value: point.valueUsd }))
                }
            ];
        },
        [summary, rangeId]
    );

    // No snapshot has been captured yet for this scope. Holdings and net worth are
    // derived solely from the balance snapshot, so without one every figure would
    // read $0 / "No holdings" — indistinguishable from a wallet that genuinely
    // holds nothing. `capturedAt === null` is the unambiguous "snapshot pending"
    // signal (it arrives as JSON null, never a Date), so we show a friendly
    // preparing state instead of misleading zeros.
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
    const pnlColor = pnlPositive ? 'var(--color-success)' : 'var(--color-danger)';
    const slices: DonutSlice[] = summary.allocation.map((entry) => ({ label: entry.symbol, value: entry.valueUsd }));

    // Range selector in the chart header (mirrors the flow chart's toggle slot).
    const rangeToggle = (
        <span className={styles.flow_toggle}>
            {BALANCE_RANGES.map((option) => (
                <Button
                    key={option.id}
                    variant={rangeId === option.id ? 'secondary' : 'ghost'}
                    size="xs"
                    aria-pressed={rangeId === option.id}
                    onClick={() => setRangeId(option.id)}
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
                {/* Net-worth-dominant header: the headline figure, PnL with an
                    arrow + signed value (non-colour cues), then realized/unrealized. */}
                <div className={styles.hero}>
                    <div className={styles.hero_primary}>
                        <span className={styles.hero_label}>Net worth</span>
                        <span className={styles.hero_value}>{formatUsd(summary.netWorthUsd)}</span>
                        <span className={styles.hero_pnl} style={{ color: pnlColor }}>
                            {pnlPositive ? <TrendingUp size={16} aria-hidden /> : <TrendingDown size={16} aria-hidden />}
                            {formatUsd(summary.totalPnlUsd, true)}
                            <span className={styles.hero_pnl_caption}>all-time PnL</span>
                        </span>
                    </div>
                    <div className={styles.hero_secondary}>
                        <div className={styles.hero_metric}>
                            <span className={styles.hero_metric_label}>Realized</span>
                            <span style={{ color: summary.realizedPnlUsd >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                {formatUsd(summary.realizedPnlUsd, true)}
                            </span>
                        </div>
                        <div className={styles.hero_metric}>
                            <span className={styles.hero_metric_label}>Unrealized</span>
                            <span style={{ color: summary.unrealizedPnlUsd >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                                {formatUsd(summary.unrealizedPnlUsd, true)}
                            </span>
                        </div>
                    </div>
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
                        actions={rangeToggle}
                        height={220}
                        yAxisFormatter={(value) => formatUsd(value)}
                        xAxisFormatter={formatAxisDay}
                        tooltipDateFormatter={formatTooltipDay}
                        emptyLabel="Building balance history…"
                    />
                    <p className="text-muted">
                        <Coins size={14} aria-hidden /> Balance over time currently reflects TRX holdings only — token balances are not yet included.
                    </p>
                    {!summary.historyBackfillComplete && (
                        <div className="alert alert--warning" role="alert">
                            <Hourglass size={14} aria-hidden /> Historical data collection for this wallet is still in progress — the chart may be incomplete until it finishes.
                        </div>
                    )}
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
