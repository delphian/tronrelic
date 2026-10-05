'use client';

/**
 * Admin panel for redirect-hit analytics on the `/system/traffic` Redirects tab.
 *
 * A served admin-managed redirect used to leave no trace: the edge middleware
 * issues the 301/302 and returns before any analytics beacon runs. This panel
 * surfaces the `redirect_events` rows now captured by that beacon so an operator
 * can answer the questions that decide whether a rule earns its keep — which
 * legacy URLs are still hit, which get zero traffic (safe to remove), and
 * whether that traffic is humans or bots.
 *
 * Self-contained by design. The Redirects tab is deliberately ungoverned by the
 * page's global period picker and bot toggle (those govern the visitor-centric
 * Analytics/Visitors tabs), so this panel owns its own window and humans-only
 * controls — mirroring how `CrawlerDashboard` owns its `sinceHours` windows.
 * Client-only, session-cookie auth, fetch-on-mount: SSR + Live Updates does not
 * apply because the hosting page is admin-gated and client-only.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LineChart } from '../../../../../features/charts/components/LineChart';
import type { ChartSeries } from '../../../../../features/charts/components/LineChart';
import { Panel } from '../../../../../components/ui/Panel';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { adminGetRedirectAnalytics } from '../../../api';
import type { AnalyticsPeriod, IRedirectAnalytics } from '../../../api';
import { SegmentedControl } from '../../../../../components/ui/SegmentedControl';
import { TabToolbar } from '../TabToolbar';
import { PanelBody } from '../PanelBody';
import styles from './RedirectAnalytics.module.scss';

/** Lookback windows offered by the panel's own picker. */
const PERIOD_OPTIONS: ReadonlyArray<{ id: AnalyticsPeriod; label: string }> = [
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' },
    { id: '90d', label: '90d' }
];

/**
 * Bot-filter segments. Modelled as a two-segment control rather than a switch
 * because both readings are legitimate views of the same data — "humans only"
 * is the default, not the "on" state of a feature.
 */
const BOT_FILTER_OPTIONS: ReadonlyArray<{ id: 'humans' | 'all'; label: string; title: string }> = [
    { id: 'humans', label: 'Humans only', title: 'Count only redirects served to human-classified requests.' },
    { id: 'all', label: 'Include bots', title: 'Also count redirects served to classified bots and crawlers.' }
];

/**
 * Resolve a CSS variable to its computed value with an SSR-safe fallback. The
 * chart line takes its color from the data-visualization palette — series
 * identity is data semantics, not brand theming, so a literal fallback is the
 * documented exception.
 *
 * @param varName - CSS variable name (e.g. '--chart-color-1').
 * @param fallback - Hex fallback when the document is unavailable.
 * @returns The resolved color string.
 */
function resolveCSSColor(varName: string, fallback: string): string {
    if (typeof document === 'undefined') {
        return fallback;
    }
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
}

/**
 * Redirect-hit analytics dashboard: a headline total with a human/bot split, a
 * hits-over-time trend, and a per-pattern breakdown of which rules are hit.
 *
 * @returns The redirect analytics panel.
 */
export function RedirectAnalytics() {
    const [period, setPeriod] = useState<AnalyticsPeriod>('7d');
    // Humans-only by default, matching the page's global bot-filter default —
    // bots hammer legacy URLs, so the honest "is anyone real still hitting this"
    // read excludes them.
    const [humansOnly, setHumansOnly] = useState(true);

    const [data, setData] = useState<IRedirectAnalytics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    // A request-id ref supersedes stale in-flight responses so a slower earlier
    // request cannot overwrite a faster later one when controls change quickly.
    const reqId = useRef(0);
    /**
     * Load the analytics for the current window + bot filter, discarding the
     * result if a newer request has since started (the request-id guard).
     *
     * @returns Resolves once state has been updated (or the response discarded).
     */
    const fetchAnalytics = useCallback(async (): Promise<void> => {
        const id = ++reqId.current;
        setLoading(true);
        setError(null);
        try {
            const result = await adminGetRedirectAnalytics(period, undefined, humansOnly);
            if (id === reqId.current) {
                setData(result);
            }
        } catch (err) {
            if (id === reqId.current) {
                setError(err instanceof Error ? err.message : 'Failed to load');
            }
        } finally {
            if (id === reqId.current) {
                setLoading(false);
            }
        }
    }, [period, humansOnly]);

    useEffect(() => { fetchAnalytics(); }, [fetchAnalytics]);

    const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);

    /**
     * Build the single hits-over-time chart series from the fetched buckets.
     * Color resolution stays outside this memo so a theme switch re-resolves on
     * the next render rather than serving a stale memoized color.
     *
     * @returns One ChartSeries, or an empty array when there is nothing to plot.
     */
    const series: ChartSeries[] = useMemo(() => {
        if (!data || data.series.length === 0) {
            return [];
        }
        return [{
            id: 'redirects',
            label: 'Redirects served',
            fill: true,
            data: data.series.map(p => ({ date: p.bucket, value: p.hits }))
        }];
    }, [data]);
    const coloredSeries: ChartSeries[] = series.map(s => ({ ...s, color: resolveCSSColor('--chart-color-1', '#3b82f6') }));

    const hasHits = data !== null && data.total > 0;
    // Only the first load blanks the panels; a control change keeps the last
    // result on screen while the new one loads.
    const firstLoad = loading && data === null;

    return (
        <section className={styles.container}>
            <TabToolbar
                title="Redirect analytics"
                meta={data
                    ? `${numberFormatter.format(data.total)} served: ${numberFormatter.format(data.humanTotal)} human, ${numberFormatter.format(data.botTotal)} bot`
                    : undefined}
                actions={(
                    <>
                        <SegmentedControl
                            label="Lookback window"
                            value={period}
                            options={PERIOD_OPTIONS}
                            onChange={setPeriod}
                        />
                        <SegmentedControl
                            label="Bot traffic filter"
                            value={humansOnly ? 'humans' : 'all'}
                            options={BOT_FILTER_OPTIONS}
                            onChange={(id) => setHumansOnly(id === 'humans')}
                        />
                    </>
                )}
                aboutSummary="Reading these figures"
                about={(
                    <p>
                        How often each admin-managed redirect is served. A rule with steady hits is
                        earning its keep; one with zero hits over a long window is a candidate for
                        removal, and appears only in the rules table below because it has no hits to
                        chart. Bots hammer stale legacy URLs, so the default view excludes them.
                    </p>
                )}
            />

            <div className={styles.band}>
                <Panel title="Redirects served" titleAs="h3" meta="Hits over time">
                    <PanelBody loading={firstLoad} error={error}>
                        <LineChart
                            series={coloredSeries}
                            height={200}
                            yAxisMin={0}
                            showLegend={false}
                            yAxisFormatter={(v) => numberFormatter.format(v)}
                            emptyLabel="No redirects served in this window."
                        />
                    </PanelBody>
                </Panel>

                <Panel title="By redirect rule" titleAs="h3" meta="Rules hit in this window">
                    <PanelBody
                        loading={firstLoad}
                        error={error}
                        empty={!hasHits || !data || data.byPattern.length === 0}
                        emptyMessage="No redirects served in this window."
                    >
                        <Table variant="compact" flush className={styles.dense_table}>
                            <Thead>
                                <Tr>
                                    <Th scope="col">Source</Th>
                                    <Th scope="col">Destination</Th>
                                    <Th scope="col" width="shrink">Code</Th>
                                    <Th scope="col" width="shrink" numeric>Hits</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {(data?.byPattern ?? []).map(row => (
                                    <Tr key={row.pattern}>
                                        <Td className={styles.code}>{row.pattern}</Td>
                                        <Td className={styles.code}>{row.destination}</Td>
                                        <Td muted>{row.permanent ? '301' : '302'}</Td>
                                        <Td numeric>{numberFormatter.format(row.hits)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </PanelBody>
                </Panel>
            </div>
        </section>
    );
}
