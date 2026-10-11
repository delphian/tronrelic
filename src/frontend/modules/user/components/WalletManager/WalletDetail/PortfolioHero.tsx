'use client';

/**
 * @fileoverview Presentational portfolio view — the money-first surface of the
 * Wallets tab, laid out like an account statement.
 *
 * Three panels, each with one job. The summary panel gives net worth as the one
 * large figure on the page, with all-time, realized, and unrealized profit and
 * loss beside it at body size. Realized and unrealized are labelled separately
 * because they mean different things (realized is taxable, unrealized is not).
 * Every gain or loss carries a directional arrow and a signed value as well as
 * its colour, so the reading never relies on colour alone.
 *
 * The holdings panel is a positions table with right-aligned tabular figures,
 * including each asset's share of net worth. That column replaces the donut
 * chart this view used to draw: the same allocation, stated exactly, in a
 * fraction of the space.
 *
 * The chart panel plots net worth over time with a 1M/3M/1Y/All range selector
 * that filters the returned series client-side — an honest zoom over data
 * actually present, not a fabricated live range. The series is unbounded,
 * reaching as far back as the wallet's ledger backfill has reconstructed. A
 * warning appears above the chart while `summary.historyBackfillComplete` is
 * false, since an in-progress backfill can shift the reconstructed curve, not
 * just shorten it.
 *
 * Pure presentation: it receives a fully-computed {@link IPortfolioSummary} and
 * renders it identically at either scope.
 */

import { useMemo, useState } from 'react';
import type { IPortfolioSummary, IPortfolioBalancePoint } from '@/types';
import { TrendingUp, TrendingDown, Hourglass } from 'lucide-react';
import { LineChart } from '../../../../../features/charts';
import { Panel } from '../../../../../components/ui/Panel';
import { StatGrid, StatTile, type StatTileTone } from '../../../../../components/ui/StatTile';
import { SegmentedControl } from '../../../../../components/ui/SegmentedControl';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Stack } from '../../../../../components/layout';
import styles from './WalletDetail.module.scss';

/** The ids of the selectable chart ranges. */
type BalanceRangeId = '1m' | '3m' | '1y' | 'all';

/** A selectable window over the balance series. `days === null` means the full series. */
interface IBalanceRange {
    /** Stable id used for the active-state comparison. */
    id: BalanceRangeId;
    /** Short segment label. */
    label: string;
    /** Trailing window in days, or null for the whole returned series. */
    days: number | null;
}

/**
 * Selectable ranges for the balance-over-time chart. These are honest
 * client-side zooms over the full series the backend returns — reaching as far
 * back as the wallet's reconstructable history — never a claim of finer or live
 * resolution.
 */
const BALANCE_RANGES: ReadonlyArray<IBalanceRange> = [
    { id: '1m', label: '1M', days: 30 },
    { id: '3m', label: '3M', days: 90 },
    { id: '1y', label: '1Y', days: 365 },
    { id: 'all', label: 'All', days: null }
];

/** Locale-independent month abbreviations, for hydration-safe date labels (UTC). */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Height of the net-worth chart. Enough to read the trend without the chart dominating the tab. */
const CHART_HEIGHT = 180;

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
    let filtered = points;
    if (days !== null && points.length > 0) {
        const cutoff = shiftDay(points[points.length - 1].day, -days);
        filtered = points.filter((point) => point.day >= cutoff);
    }
    return filtered;
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
 * Format a USD amount for display. Amounts of $1,000 or more drop the cents,
 * because at that size the cents only add width to a column without changing
 * how the figure is read.
 *
 * @param value - USD amount.
 * @param signed - When true, prefixes a `+` for non-negative values, so a
 *        profit-and-loss figure always states its direction.
 * @returns A formatted USD string.
 */
function formatUsd(value: number, signed = false): string {
    const sign = signed && value >= 0 ? '+' : value < 0 ? '-' : '';
    const abs = Math.abs(value);
    const body = abs >= 1000
        ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 })
        : abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${sign}$${body}`;
}

/**
 * Format a unit price. A token can be priced at a small fraction of a cent, so
 * a fixed two-place format would show `$0.00` for a real price; four
 * significant digits keep sub-cent prices readable while larger prices still
 * read as ordinary dollars and cents.
 *
 * @param value - USD price per unit.
 * @returns A formatted price string.
 */
function formatPrice(value: number): string {
    const body = value >= 1
        ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : value.toLocaleString('en-US', { maximumSignificantDigits: 4 });
    return `$${body}`;
}

/**
 * Format a token quantity for the holdings table. Capped at two fraction digits
 * so the column reads as a scannable ledger — long six-place tails (TRX and
 * TRC20 alike) misalign the rows and bury magnitude. This only ever reduces
 * precision: the default `minimumFractionDigits` of 0 leaves whole amounts
 * unpadded, so a sub-1 balance rounds to two places while `1234` stays `1,234`.
 *
 * A real sub-0.005 holding (a small slice of a high-unit-value token) would
 * round to `"0"` beside a positive Value and PnL in the same row — a visible
 * contradiction. It floors to `"<0.01"` instead, showing real activity without
 * a third decimal, keeping the two-place cap intact.
 *
 * @param value - Quantity in human units.
 * @returns A formatted quantity string.
 */
function formatQty(value: number): string {
    return value > 0 && value < 0.005
        ? '<0.01'
        : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Format an allocation fraction as a percentage with one decimal, the
 * precision a reader needs to compare positions without the column turning
 * into noise.
 *
 * @param fraction - Share of net worth, from 0 to 1.
 * @returns A formatted percentage such as `42.3%`.
 */
function formatPercent(fraction: number): string {
    return `${(fraction * 100).toFixed(1)}%`;
}

/**
 * Map a profit-and-loss amount to the stat tile tone that colours it, so the
 * summary tiles and the holdings table agree on what counts as a gain.
 *
 * @param value - USD profit or loss.
 * @returns `success` for zero or a gain, `danger` for a loss.
 */
function pnlTone(value: number): StatTileTone {
    return value >= 0 ? 'success' : 'danger';
}

/**
 * Props for {@link SignedUsd}.
 */
interface ISignedUsdProps {
    /** USD profit or loss to render with its direction. */
    value: number;
}

/**
 * Render a profit-or-loss amount with a direction arrow and an explicit sign.
 * The arrow and sign carry the direction for readers who cannot tell the
 * success and danger colours apart, so colour is never the only cue.
 *
 * @param props - {@link ISignedUsdProps}.
 * @returns The arrow and the signed amount, inline.
 */
function SignedUsd({ value }: ISignedUsdProps) {
    return (
        <span className={styles.signed}>
            {value >= 0 ? <TrendingUp size={14} aria-hidden /> : <TrendingDown size={14} aria-hidden />}
            {formatUsd(value, true)}
        </span>
    );
}

/**
 * Props for {@link PortfolioHero}.
 */
interface IPortfolioHeroProps {
    /** The computed portfolio summary to render. */
    summary: IPortfolioSummary;
}

/**
 * Render the portfolio summary, holdings, and net-worth chart for one scope.
 *
 * @param props - {@link IPortfolioHeroProps}.
 * @returns The three portfolio panels, or a single notice while the first
 *          balance snapshot is still pending.
 */
export function PortfolioHero({ summary }: IPortfolioHeroProps) {
    // Hooks run before the snapshot-pending early return so their call order stays
    // stable across renders (React's rules-of-hooks).
    const [rangeId, setRangeId] = useState<BalanceRangeId>('3m');

    // The balance series clipped to the active range. Only TRX is sourced today —
    // the backend reconstructs the TRX balance alone — so the panel meta stays
    // honest about scope; the range only zooms the window.
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

    // Each holding's share of net worth, looked up by asset id for the table's
    // allocation column. The backend computes the fractions over priced value.
    const allocationByAsset = useMemo(
        () => new Map(summary.allocation.map((slice) => [slice.asset, slice.fraction])),
        [summary]
    );

    // No snapshot has been captured yet for this scope. Holdings and net worth are
    // derived solely from the balance snapshot, so without one every figure would
    // read $0 / "No holdings" — indistinguishable from a wallet that genuinely
    // holds nothing. `capturedAt === null` is the unambiguous "snapshot pending"
    // signal (it arrives as JSON null, never a Date), so we show a short
    // preparing notice instead of misleading zeros.
    if (summary.capturedAt === null) {
        return (
            <Panel title="Portfolio" tone="muted">
                <p className={styles.notice}>
                    <Hourglass size={14} aria-hidden />
                    Capturing your current balances. Net worth and holdings appear here once the
                    first snapshot completes, usually within a few hours.
                </p>
            </Panel>
        );
    }

    const unpricedCount = summary.unpricedAssets.length;
    const holdingsMeta = `${summary.holdings.length} ${summary.holdings.length === 1 ? 'asset' : 'assets'}`
        + (unpricedCount > 0 ? `, ${unpricedCount} without a price and left out of totals` : '');

    return (
        <Stack gap="sm">
            <Panel
                title="Portfolio"
                meta={<>Valued <ClientTime date={summary.capturedAt} format="relative" /></>}
            >
                <StatGrid size="sm">
                    <StatTile size="md" surface={false} label="Net worth" value={formatUsd(summary.netWorthUsd)} />
                    <StatTile
                        size="sm"
                        surface={false}
                        label="All-time P&L"
                        tone={pnlTone(summary.totalPnlUsd)}
                        value={<SignedUsd value={summary.totalPnlUsd} />}
                        note={summary.basisApproximate ? 'Approximate cost basis' : undefined}
                    />
                    <StatTile
                        size="sm"
                        surface={false}
                        label="Realized"
                        tone={pnlTone(summary.realizedPnlUsd)}
                        value={<SignedUsd value={summary.realizedPnlUsd} />}
                    />
                    <StatTile
                        size="sm"
                        surface={false}
                        label="Unrealized"
                        tone={pnlTone(summary.unrealizedPnlUsd)}
                        value={<SignedUsd value={summary.unrealizedPnlUsd} />}
                    />
                </StatGrid>
                {summary.historyBackfillComplete && summary.basisApproximate && (
                    <p className={styles.footnote}>
                        Some early history is beyond what data sources can reach, so profit and cost basis
                        are approximate. Net worth is exact, because it comes from live balances.
                    </p>
                )}
            </Panel>

            <Panel title="Holdings" meta={holdingsMeta}>
                <Table variant="compact" flush>
                    <Thead>
                        <Tr>
                            <Th width="expand">Asset</Th>
                            <Th numeric>Quantity</Th>
                            <Th numeric>Price</Th>
                            <Th numeric>Value</Th>
                            <Th numeric>Weight</Th>
                            <Th numeric>Unrealized</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {summary.holdings.length === 0 ? (
                            <Tr>
                                <Td colSpan={6} muted>No holdings yet.</Td>
                            </Tr>
                        ) : (
                            summary.holdings.map((holding) => {
                                const priced = holding.priceUsd !== null;
                                const fraction = allocationByAsset.get(holding.asset);
                                return (
                                    <Tr key={holding.asset}>
                                        <Td className={styles.asset}>{holding.symbol}</Td>
                                        <Td numeric>{formatQty(holding.quantity)}</Td>
                                        <Td numeric muted>{holding.priceUsd !== null ? formatPrice(holding.priceUsd) : '—'}</Td>
                                        <Td numeric>{priced ? formatUsd(holding.valueUsd) : '—'}</Td>
                                        <Td numeric muted>{priced && fraction !== undefined ? formatPercent(fraction) : '—'}</Td>
                                        <Td numeric>
                                            {priced ? (
                                                <span className={holding.unrealizedPnlUsd >= 0 ? styles.value_in : styles.value_out}>
                                                    {formatUsd(holding.unrealizedPnlUsd, true)}
                                                </span>
                                            ) : (
                                                <span className="text-muted">unpriced</span>
                                            )}
                                        </Td>
                                    </Tr>
                                );
                            })
                        )}
                    </Tbody>
                </Table>
            </Panel>

            <Panel
                title="Net worth over time"
                meta="TRX holdings only"
                actions={
                    <SegmentedControl
                        label="Chart range"
                        value={rangeId}
                        options={BALANCE_RANGES}
                        onChange={setRangeId}
                    />
                }
            >
                {!summary.historyBackfillComplete && (
                    <p className={styles.notice} role="status">
                        <Hourglass size={14} aria-hidden style={{ color: 'var(--color-warning)' }} />
                        History for this wallet is still downloading, so the chart may be incomplete until it finishes.
                    </p>
                )}
                <LineChart
                    series={balanceSeries}
                    height={CHART_HEIGHT}
                    yAxisFormatter={(value) => formatUsd(value)}
                    xAxisFormatter={formatAxisDay}
                    tooltipDateFormatter={formatTooltipDay}
                    emptyLabel="Building balance history…"
                />
            </Panel>
        </Stack>
    );
}
