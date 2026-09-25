'use client';

/**
 * @fileoverview The Activity view of a ClickHouse account: totals and a daily
 * chart over a chosen window, the daily figures as a table, and, for a managed
 * account, how much of this hour's quota each quota key has used.
 *
 * ClickHouse's own query log keeps three days, so the history comes from the
 * accounts module's daily rollup table, which keeps a year. The chart splits
 * each day into queries that finished, queries a limit stopped, and queries
 * that failed for another reason, because a rising count of limit stops is the
 * signal that an account's limits are too tight for its work.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IClickHouseAccountQuotaUsage, IClickHouseAccountUsageDay } from '@/types';
import { Stack } from '../../../../components/layout';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { Skeleton } from '../../../../components/ui/Skeleton';
import { StatGrid, StatTile } from '../../../../components/ui/StatTile';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { BarChart, type BarChartSeries } from '../../../../features/charts';
import { formatBytes } from '../../../../lib/format';
import { getClickHouseAccountUsage } from '../../api/client';
import { formatCount, formatMilliseconds, formatSeconds } from '../../lib/formatQuantity';
import styles from './ActivityView.module.scss';

/** Window lengths the admin can choose, in days. */
type WindowDays = '7' | '30' | '90';

const WINDOW_OPTIONS: ReadonlyArray<{ id: WindowDays; label: string }> = [
    { id: '7', label: '7 days' },
    { id: '30', label: '30 days' },
    { id: '90', label: '90 days' }
];

/** Date format for chart axis ticks: short month and day, in UTC to match the rollup's days. */
const AXIS_DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Props for the Activity view.
 */
interface IActivityViewProps {
    /** Account whose activity to show. */
    accountId: string;
    /** Whether the account is managed, which is when it has a quota to show. */
    managed: boolean;
}

/**
 * Fill the days a window covers, adding zero rows for days with no queries.
 *
 * The rollup has no row for a quiet day. Leaving those days out would make
 * the chart's bars sit side by side as if the days were consecutive, which
 * hides a stretch of silence, and silence is often the thing to notice.
 *
 * @param history - Rows from the rollup, oldest first.
 * @param days - Window length, today included.
 * @returns One row per UTC day in the window, oldest first.
 */
function fillDays(history: IClickHouseAccountUsageDay[], days: number): IClickHouseAccountUsageDay[] {
    const byDay = new Map(history.map(row => [row.day, row]));
    const filled: IClickHouseAccountUsageDay[] = [];
    const today = new Date();
    for (let offset = days - 1; offset >= 0; offset -= 1) {
        const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
        const day = date.toISOString().slice(0, 10);
        filled.push(byDay.get(day) ?? {
            day, queries: 0, failed: 0, limitHits: 0, denied: 0, readRows: 0, readBytes: 0,
            resultRows: 0, totalDurationMs: 0, maxDurationMs: 0, maxMemoryBytes: 0
        });
    }

    return filled;
}

/**
 * Show an account's activity over a chosen window.
 *
 * The data is fetched when the view opens and when the window changes. The
 * view mounts only when its tab is selected, as every panel on this page
 * does, so the request happens on arrival rather than on page load.
 *
 * @param props - The account and whether it is managed.
 * @returns The Activity view.
 */
export function ActivityView({ accountId, managed }: IActivityViewProps) {
    const [windowDays, setWindowDays] = useState<WindowDays>('30');
    const [history, setHistory] = useState<IClickHouseAccountUsageDay[] | null>(null);
    const [quota, setQuota] = useState<IClickHouseAccountQuotaUsage[]>([]);
    const [error, setError] = useState<string | null>(null);
    // Sequence number of the latest request, so a slow response for a window
    // the admin has already left cannot replace the one now selected.
    const latestRequest = useRef(0);

    /**
     * Load the window's history and the current quota usage, ignoring the
     * answer if a newer request has started since, so the chart always
     * matches the selected window.
     */
    const load = useCallback(async () => {
        const request = ++latestRequest.current;
        try {
            const usage = await getClickHouseAccountUsage(accountId, Number(windowDays));
            if (request === latestRequest.current) {
                setHistory(fillDays(usage.history, Number(windowDays)));
                setQuota(usage.quota);
                setError(null);
            }
        } catch (err) {
            if (request === latestRequest.current) {
                setError(err instanceof Error ? err.message : String(err));
            }
        }
    }, [accountId, windowDays]);

    useEffect(() => {
        void load();
    }, [load]);

    /** Totals over the window, for the stat tiles. */
    const totals = useMemo(() => (history ?? []).reduce((sum, row) => ({
        queries: sum.queries + row.queries,
        failed: sum.failed + row.failed,
        limitHits: sum.limitHits + row.limitHits,
        readRows: sum.readRows + row.readRows,
        longestMs: Math.max(sum.longestMs, row.maxDurationMs)
    }), { queries: 0, failed: 0, limitHits: 0, readRows: 0, longestMs: 0 }), [history]);

    /** The three stacked series: finished, stopped by a limit, failed otherwise. */
    const series = useMemo<BarChartSeries[]>(() => {
        const rows = history ?? [];
        /**
         * Turn a rollup day into the ISO instant the chart plots, at UTC
         * midnight so the bar lands on the day the rollup counted.
         *
         * @param day - `YYYY-MM-DD` from the rollup.
         * @returns The ISO timestamp for that day's start.
         */
        const at = (day: string) => `${day}T00:00:00.000Z`;
        return [
            { id: 'finished', label: 'Finished', color: 'var(--chart-color-1)', data: rows.map(row => ({ date: at(row.day), value: row.queries - row.failed })) },
            { id: 'limit', label: 'Stopped by a limit', color: 'var(--color-warning)', data: rows.map(row => ({ date: at(row.day), value: row.limitHits })) },
            { id: 'failed', label: 'Failed for another reason', color: 'var(--color-danger)', data: rows.map(row => ({ date: at(row.day), value: row.failed - row.limitHits })) }
        ];
    }, [history]);

    return (
        <Stack gap="md">
            <div className={styles.toolbar}>
                <SegmentedControl
                    label="Activity window"
                    options={WINDOW_OPTIONS}
                    value={windowDays}
                    onChange={setWindowDays}
                />
            </div>

            {error && <p className="alert" role="alert">{error}</p>}

            {history === null && !error ? (
                <Skeleton className={styles.placeholder} />
            ) : history && (
                <>
                    <StatGrid size="sm">
                        <StatTile size="sm" label="Queries" value={formatCount(totals.queries)} />
                        <StatTile size="sm" label="Failed" value={formatCount(totals.failed)} tone={totals.failed > 0 ? 'danger' : 'neutral'} />
                        <StatTile size="sm" label="Stopped by a limit" value={formatCount(totals.limitHits)} tone={totals.limitHits > 0 ? 'warning' : 'neutral'} />
                        <StatTile size="sm" label="Rows scanned" value={formatCount(totals.readRows)} />
                        <StatTile size="sm" label="Longest query" value={formatMilliseconds(totals.longestMs)} />
                    </StatGrid>

                    <BarChart
                        series={series}
                        layout="stacked"
                        height={220}
                        integerTicks
                        showLegend
                        xAxisFormatter={date => AXIS_DATE.format(date)}
                        tooltipDateFormatter={date => AXIS_DATE.format(date)}
                        yAxisFormatter={value => formatCount(value)}
                        emptyLabel="No queries in this window."
                    />

                    <details className={styles.details}>
                        <summary>Daily figures</summary>
                        <Table variant="compact">
                            <Thead>
                                <Tr>
                                    <Th>Day</Th>
                                    <Th numeric>Queries</Th>
                                    <Th numeric>Failed</Th>
                                    <Th numeric>Stopped by a limit</Th>
                                    <Th numeric>Refused</Th>
                                    <Th numeric>Rows scanned</Th>
                                    <Th numeric>Data scanned</Th>
                                    <Th numeric>Longest</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {[...history].reverse().map(row => (
                                    <Tr key={row.day}>
                                        <Td>{row.day}</Td>
                                        <Td numeric>{formatCount(row.queries)}</Td>
                                        <Td numeric>{formatCount(row.failed)}</Td>
                                        <Td numeric>{formatCount(row.limitHits)}</Td>
                                        <Td numeric>{formatCount(row.denied)}</Td>
                                        <Td numeric>{formatCount(row.readRows)}</Td>
                                        <Td numeric>{formatBytes(row.readBytes)}</Td>
                                        <Td numeric>{formatMilliseconds(row.maxDurationMs)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </details>
                </>
            )}

            {managed && history && (
                <section className={styles.quota} aria-labelledby={`${accountId}-quota-title`}>
                    <h5 id={`${accountId}-quota-title`} className={styles.quota_title}>This hour, per quota key</h5>
                    {quota.length === 0 ? (
                        <p className={styles.empty}>No queries have counted against the quota this hour.</p>
                    ) : (
                        <Table variant="compact">
                            <Thead>
                                <Tr>
                                    <Th>Quota key</Th>
                                    <Th numeric>Queries</Th>
                                    <Th numeric>Rows scanned</Th>
                                    <Th numeric>Query time</Th>
                                    <Th>Resets</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {quota.map(row => (
                                    <Tr key={row.quotaKey}>
                                        <Td><code className={styles.key}>{row.quotaKey || 'No key'}</code></Td>
                                        <Td numeric>{formatCount(row.queries)}{row.maxQueries !== null && ` of ${formatCount(row.maxQueries)}`}</Td>
                                        <Td numeric>{formatCount(row.readRows)}{row.maxReadRows !== null && ` of ${formatCount(row.maxReadRows)}`}</Td>
                                        <Td numeric>{formatSeconds(row.executionSeconds)}{row.maxExecutionSeconds !== null && ` of ${formatSeconds(row.maxExecutionSeconds)}`}</Td>
                                        <Td>{row.intervalEndsAt ? <ClientTime date={row.intervalEndsAt} format="time" /> : '—'}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    )}
                </section>
            )}
        </Stack>
    );
}
