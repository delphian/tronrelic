'use client';

/**
 * @fileoverview Switches tab of `/system/localization`.
 *
 * Shows how often visitors used the language switcher over a chosen window:
 * a daily chart, the directions they moved in, and the routes they moved on.
 * It answers whether a published translation is being found and used, which
 * the page-view figures cannot show, because a switch and an ordinary visit to
 * a `/zh/...` page look the same there.
 *
 * Like the other `/system` managers it fetches its own data on mount: the
 * SSR + Live Updates rule covers public pages, and admin surfaces are exempt
 * by the `/system` convention.
 *
 * @module modules/localization/components/admin/SwitchesTab
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_LANGUAGE, type ILanguageSwitchStats } from '@/types';
import { Grid, Stack } from '../../../../components/layout';
import { Panel } from '../../../../components/ui/Panel';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { StatGrid, StatTile } from '../../../../components/ui/StatTile';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { BarChart, type BarChartSeries } from '../../../../features/charts';
import { getLanguageSwitchStats } from '../../api/client';
import { useLocalization } from '../../hooks/useLocalization';
import styles from './LocalizationAdmin.module.scss';

/** Window lengths the admin can choose, in days. */
type WindowDays = '7' | '30' | '90';

const WINDOW_OPTIONS: ReadonlyArray<{ id: WindowDays; label: string }> = [
    { id: '7', label: '7 days' },
    { id: '30', label: '30 days' },
    { id: '90', label: '90 days' }
];

/** Date format for chart ticks: short month and day, in UTC to match the counters' days. */
const AXIS_DATE = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Thousands separators for counts, fixed to one locale so every admin reads the same digits. */
const COUNT = new Intl.NumberFormat('en');

/**
 * The Switches tab: totals, a daily chart, and breakdowns by direction and route.
 *
 * @returns The tab content.
 */
export function SwitchesTab() {
    const [windowDays, setWindowDays] = useState<WindowDays>('30');
    const [stats, setStats] = useState<ILanguageSwitchStats | null>(null);
    const [error, setError] = useState<string | null>(null);
    const { config } = useLocalization();
    // Sequence number of the latest request, so a slow answer for a window the
    // admin has already left cannot replace the one now selected.
    const latestRequest = useRef(0);

    /**
     * Load the selected window, ignoring the answer if a newer request has
     * started since, so the figures always match the selected window.
     */
    const load = useCallback(async () => {
        const request = ++latestRequest.current;
        try {
            const next = await getLanguageSwitchStats(Number(windowDays));
            if (request === latestRequest.current) {
                setStats(next);
                setError(null);
            }
        } catch (err) {
            if (request === latestRequest.current) {
                setError(err instanceof Error ? err.message : String(err));
            }
        }
    }, [windowDays]);

    useEffect(() => {
        void load();
    }, [load]);

    /**
     * Name a language the way the switcher shows it, so the tables read as
     * languages rather than codes. A language disabled since the click was
     * counted is no longer in the public snapshot, so it falls back to its code.
     *
     * @param code - Language code from a counter.
     * @returns The language's English name, or the code when it is not enabled.
     */
    const languageName = useCallback((code: string): string => {
        const name = code === DEFAULT_LANGUAGE
            ? 'English'
            : config.languages.find(language => language.code === code)?.name;
        return name ?? code;
    }, [config.languages]);

    /** Switches into a translation versus back to English, for the stat tiles. */
    const split = useMemo(() => (stats?.byPair ?? []).reduce((sum, pair) => ({
        away: sum.away + (pair.to !== DEFAULT_LANGUAGE ? pair.count : 0),
        back: sum.back + (pair.to === DEFAULT_LANGUAGE ? pair.count : 0)
    }), { away: 0, back: 0 }), [stats]);

    /** The busiest day in the window, or null when nothing was recorded. */
    const busiest = useMemo(() => (stats?.byDay ?? []).reduce<{ day: string; count: number } | null>(
        (best, day) => (day.count > 0 && (!best || day.count > best.count) ? day : best),
        null
    ), [stats]);

    /** The daily series the chart plots, one bar per UTC day. */
    const series = useMemo<BarChartSeries[]>(() => [{
        id: 'switches',
        label: 'Switches',
        color: 'var(--chart-color-1)',
        data: (stats?.byDay ?? []).map(day => ({ date: `${day.day}T00:00:00.000Z`, value: day.count }))
    }], [stats]);

    return (
        <Stack gap="md">
            <Panel
                title="Language switches"
                meta={stats
                    ? `${stats.windowStart} to ${stats.windowEnd} (UTC). Visitors on the traffic ignore list and automated browsers are not counted.`
                    : 'Clicks on the language switcher'}
                actions={(
                    <SegmentedControl
                        label="Switches window"
                        options={WINDOW_OPTIONS}
                        value={windowDays}
                        onChange={setWindowDays}
                    />
                )}
            >
                {error && <p className="alert" role="alert">{error}</p>}
                {!stats && !error && <div className={styles.placeholder}>Loading switches…</div>}
                {stats && (
                    <Stack gap="md">
                        <StatGrid size="sm">
                            <StatTile size="sm" label="Switches" value={COUNT.format(stats.total)} />
                            <StatTile size="sm" label="Into a translation" value={COUNT.format(split.away)} />
                            <StatTile size="sm" label="Back to English" value={COUNT.format(split.back)} />
                            <StatTile
                                size="sm"
                                label="Busiest day"
                                value={busiest ? COUNT.format(busiest.count) : '—'}
                                note={busiest?.day}
                            />
                        </StatGrid>
                        <BarChart
                            series={series}
                            height={220}
                            integerTicks
                            xAxisFormatter={date => AXIS_DATE.format(date)}
                            tooltipDateFormatter={date => AXIS_DATE.format(date)}
                            yAxisFormatter={value => COUNT.format(value)}
                            emptyLabel="No switches in this window."
                        />
                    </Stack>
                )}
            </Panel>

            {stats && stats.total === 0 && (
                <div className={styles.placeholder}>
                    Nothing recorded yet. The switcher only appears on pages published in another language, so publish a route and place the Language switcher widget first.
                </div>
            )}

            {stats && stats.total > 0 && (
                <Grid columns={2} gap="md">
                    <Panel title="By direction" titleAs="h3" meta="Which way visitors moved">
                        <Table variant="compact" flush>
                            <Thead>
                                <Tr>
                                    <Th>From</Th>
                                    <Th>To</Th>
                                    <Th numeric>Switches</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {stats.byPair.map(pair => (
                                    <Tr key={`${pair.from}-${pair.to}`}>
                                        <Td>{languageName(pair.from)}</Td>
                                        <Td>{languageName(pair.to)}</Td>
                                        <Td numeric>{COUNT.format(pair.count)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </Panel>
                    <Panel title="By route" titleAs="h3" meta="The published route the page belongs to">
                        <Table variant="compact" flush>
                            <Thead>
                                <Tr>
                                    <Th>Route</Th>
                                    <Th numeric>Switches</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {stats.byRoute.map(route => (
                                    <Tr key={route.pattern}>
                                        <Td><span className={styles.mono}>{route.pattern}</span></Td>
                                        <Td numeric>{COUNT.format(route.count)}</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </Panel>
                </Grid>
            )}
        </Stack>
    );
}
