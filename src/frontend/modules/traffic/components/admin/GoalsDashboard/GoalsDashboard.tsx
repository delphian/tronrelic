'use client';

/**
 * @fileoverview The Goals tab of `/system/traffic`.
 *
 * A goal is a visitor action another component reports as a result, such as a
 * click on a link to an energy rental market. Before goals were recorded here,
 * those clicks were only counted as per-market totals with nothing tying a
 * click to the visitor who made it, so a burst could not be told apart from an
 * operator testing links. This tab lists the goals reached in the window and,
 * for the one selected, shows where those visitors came from (the source and
 * landing page of the session each goal happened in) and how the goal breaks
 * down by one of its properties.
 *
 * Governed by the page's global period picker and bot filter, like the
 * Analytics tab, so the figures sit in the same window as the visitors they
 * are compared with. Client-only and fetched after mount, as every panel on
 * this admin-gated page is; earlier figures stay on screen while a control
 * change reloads them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../../../../../components/ui/Panel';
import { Select } from '../../../../../components/ui/Select';
import { SegmentedControl } from '../../../../../components/ui/SegmentedControl';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { adminGetGoalAttribution, adminGetGoalProperties, adminGetGoals } from '../../../api';
import type {
    AnalyticsPeriod,
    GoalAttributionDimension,
    GoalAttributionKind,
    ICustomDateRange,
    IGoalReadOptions,
    ITrafficGoalAttributionBucket,
    ITrafficGoalPropertyBucket,
    ITrafficGoalSummary
} from '../../../api';
import { TabToolbar } from '../TabToolbar';
import { PanelBody } from '../PanelBody';
import styles from './GoalsDashboard.module.scss';

/** The two ways a goal can be attributed to its session. */
const ATTRIBUTION_OPTIONS: ReadonlyArray<{ id: GoalAttributionDimension; label: string; title: string }> = [
    { id: 'source', label: 'Source', title: 'Group by the source of the session each goal happened in.' },
    { id: 'landing-page', label: 'Landing page', title: 'Group by the page the session each goal happened in started on.' }
];

/**
 * What each bucket outside a credited session means, shown as the row's
 * tooltip so an operator does not have to look the label up.
 */
const KIND_EXPLANATIONS: Readonly<Record<Exclude<GoalAttributionKind, 'session'>, string>> = {
    'unattributed': 'No analytics cookie: visitors who have not allowed analytics, or had no cookie yet. Counted anonymously.',
    'no-session': 'A cookie, but no page session was running when the goal fired, typical of a client that never ran the page.',
    'resumed-session': 'The goal happened in a tab resumed after 30 minutes idle, which has no source or landing page.'
};

/**
 * Props for the Goals tab, all supplied by the page's global controls.
 */
interface IGoalsDashboardProps {
    /** The global period picker's preset. */
    period: AnalyticsPeriod;
    /** The custom range when the picker is on "custom", else undefined. */
    customRange?: ICustomDateRange;
    /** Whether the global bot filter includes known bots. */
    includeBots: boolean;
    /** The page's shared refresh clock; each tick reloads the figures in place. */
    refreshSignal?: number;
}

/**
 * Hold one read's result, its error, and whether it is loading, discarding a
 * response that a newer request has superseded so a slow earlier answer can
 * never overwrite a faster later one.
 *
 * @param load - Fetches the data for the current inputs, or null when there is
 *   nothing to fetch (no goal selected yet).
 * @returns The latest data, the error message, and the loading flag.
 */
function useLatestRead<T>(load: (() => Promise<T>) | null): { data: T | null; error: string | null; loading: boolean } {
    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Starts true when there is something to load, so the first render shows
    // "Loading" rather than flashing the empty message before the effect runs.
    const [loading, setLoading] = useState(load !== null);
    const requestId = useRef(0);

    /**
     * Run the loader whenever it is replaced, which happens when an input it
     * closes over changes, and clear the data when there is nothing to load.
     */
    useEffect(() => {
        const id = ++requestId.current;
        if (load) {
            setLoading(true);
            setError(null);
            load()
                .then(result => {
                    if (id === requestId.current) setData(result);
                })
                .catch((err: unknown) => {
                    if (id === requestId.current) setError(err instanceof Error ? err.message : 'Failed to load');
                })
                .finally(() => {
                    if (id === requestId.current) setLoading(false);
                });
        } else {
            setData(null);
            setLoading(false);
        }
    }, [load]);

    return { data, error, loading };
}

/**
 * The Goals tab: goals reached in the window, and for the selected goal its
 * session attribution and property breakdown.
 *
 * @param props - The window, bot filter, and refresh clock from the page.
 * @returns The goals dashboard.
 */
export function GoalsDashboard({ period, customRange, includeBots, refreshSignal }: IGoalsDashboardProps) {
    const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
    const [attributeBy, setAttributeBy] = useState<GoalAttributionDimension>('source');
    const [propertyKey, setPropertyKey] = useState<string | null>(null);
    const numberFormatter = useMemo(() => new Intl.NumberFormat(), []);

    const options = useMemo<IGoalReadOptions>(
        () => ({ period, customRange, excludeBots: !includeBots }),
        [period, customRange, includeBots]
    );

    /** Load every goal in the window; re-created on a window change or refresh tick. */
    const loadGoals = useCallback(
        () => adminGetGoals(options),
        // refreshSignal is a dependency so each tick makes a new loader and reloads.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [options, refreshSignal]
    );
    const goals = useLatestRead<ITrafficGoalSummary[]>(loadGoals);

    /**
     * Keep a goal selected: the first one by default, and a new first one when
     * the selected goal is not reached in the newly chosen window.
     */
    useEffect(() => {
        const list = goals.data;
        if (list && !list.some(g => g.goal === selectedGoal)) {
            setSelectedGoal(list[0]?.goal ?? null);
        }
    }, [goals.data, selectedGoal]);

    const selectedSummary = goals.data?.find(g => g.goal === selectedGoal) ?? null;

    /** Keep a property selected that the selected goal actually carries. */
    useEffect(() => {
        const keys = selectedSummary?.propertyKeys ?? [];
        if (!propertyKey || !keys.includes(propertyKey)) {
            setPropertyKey(keys[0] ?? null);
        }
    }, [selectedSummary, propertyKey]);

    /** Load the selected goal's attribution, or nothing until a goal is selected. */
    const loadAttribution = useMemo(
        () => (selectedGoal ? () => adminGetGoalAttribution(selectedGoal, attributeBy, options) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedGoal, attributeBy, options, refreshSignal]
    );
    const attribution = useLatestRead<ITrafficGoalAttributionBucket[]>(loadAttribution);

    /** Load the selected goal's property breakdown, or nothing without a goal and key. */
    const loadProperties = useMemo(
        () => (selectedGoal && propertyKey ? () => adminGetGoalProperties(selectedGoal, propertyKey, options) : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedGoal, propertyKey, options, refreshSignal]
    );
    const properties = useLatestRead<ITrafficGoalPropertyBucket[]>(loadProperties);

    /** Sum the goals' events and anonymous events for the toolbar line. */
    const totals = useMemo(() => (goals.data ?? []).reduce(
        (sum, g) => ({ events: sum.events + g.events, anonymous: sum.anonymous + g.unattributedEvents }),
        { events: 0, anonymous: 0 }
    ), [goals.data]);

    return (
        <section className={styles.container}>
            <TabToolbar
                title="Goals"
                meta={goals.data
                    ? `${numberFormatter.format(totals.events)} goal events, ${numberFormatter.format(totals.anonymous)} anonymous`
                    : undefined}
                aboutSummary="Reading these figures"
                about={(
                    <>
                        <p>
                            A goal is something a visitor did that counts as a result, reported by the part of the
                            site that owns the action, such as a click on a link to a rental market. Visitors are
                            counted by the same rule as the Analytics tab: a browser that loaded a page in this
                            window. Accounts on the ignore list and, by default, known bots are left out.
                        </p>
                        <p>
                            Each goal is credited to the session it happened in, so its source and landing page
                            are the ones the Analytics tab shows for that session. Goals from visitors who have not
                            allowed analytics carry no cookie and are counted anonymously, under "(unattributed)".
                        </p>
                    </>
                )}
            />

            <Panel title="Goals reached" titleAs="h3" meta="Select a goal to see where it came from">
                <PanelBody
                    loading={goals.loading && goals.data === null}
                    error={goals.error}
                    empty={(goals.data ?? []).length === 0}
                    emptyMessage="No goals were reached in this window."
                >
                    <Table variant="compact" flush stackAt="phone">
                        <Thead>
                            <Tr>
                                <Th scope="col">Goal</Th>
                                <Th scope="col" width="shrink" numeric>Events</Th>
                                <Th scope="col" width="shrink" numeric>Visitors</Th>
                                <Th scope="col" width="shrink" numeric>Anonymous</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {(goals.data ?? []).map(row => (
                                <Tr
                                    key={row.goal}
                                    onClick={() => setSelectedGoal(row.goal)}
                                    aria-current={row.goal === selectedGoal ? 'true' : undefined}
                                    className={row.goal === selectedGoal ? styles.row_selected : undefined}
                                >
                                    <Td className={styles.code}>{row.goal}</Td>
                                    <Td label="Events" numeric>{numberFormatter.format(row.events)}</Td>
                                    <Td label="Visitors" numeric>{numberFormatter.format(row.visitors)}</Td>
                                    <Td label="Anonymous" numeric muted>{numberFormatter.format(row.unattributedEvents)}</Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                </PanelBody>
            </Panel>

            {selectedGoal && (
                <div className={styles.band}>
                    <Panel
                        title="Where it came from"
                        titleAs="h3"
                        meta="The session each goal happened in"
                        actions={(
                            <SegmentedControl
                                label="Attribute goals by"
                                value={attributeBy}
                                options={ATTRIBUTION_OPTIONS}
                                onChange={setAttributeBy}
                            />
                        )}
                    >
                        <PanelBody
                            loading={attribution.loading && attribution.data === null}
                            error={attribution.error}
                            empty={(attribution.data ?? []).length === 0}
                            emptyMessage="No events for this goal in this window."
                        >
                            <Table variant="compact" flush stackAt="phone">
                                <Thead>
                                    <Tr>
                                        <Th scope="col">{attributeBy === 'source' ? 'Source' : 'Landing page'}</Th>
                                        <Th scope="col" width="shrink" numeric>Events</Th>
                                        <Th scope="col" width="shrink" numeric>Visitors</Th>
                                        <Th scope="col" width="shrink" numeric>Sessions</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {(attribution.data ?? []).map(row => (
                                        <Tr key={`${row.kind}:${row.key}`}>
                                            <Td
                                                className={row.kind === 'session' ? styles.code : styles.special}
                                                title={row.kind === 'session' ? undefined : KIND_EXPLANATIONS[row.kind]}
                                            >
                                                {row.key}
                                                {row.channel && <span className={styles.channel}> · {row.channel}</span>}
                                            </Td>
                                            <Td label="Events" numeric>{numberFormatter.format(row.events)}</Td>
                                            <Td label="Visitors" numeric>{numberFormatter.format(row.visitors)}</Td>
                                            <Td label="Sessions" numeric muted>{numberFormatter.format(row.sessions)}</Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        </PanelBody>
                    </Panel>

                    <Panel
                        title="By property"
                        titleAs="h3"
                        meta={selectedGoal}
                        actions={(selectedSummary?.propertyKeys.length ?? 0) > 0 ? (
                            <Select
                                aria-label="Property to break the goal down by"
                                value={propertyKey ?? ''}
                                onChange={(event) => setPropertyKey(event.target.value)}
                            >
                                {(selectedSummary?.propertyKeys ?? []).map(key => (
                                    <option key={key} value={key}>{key}</option>
                                ))}
                            </Select>
                        ) : undefined}
                    >
                        <PanelBody
                            loading={properties.loading && properties.data === null}
                            error={properties.error}
                            empty={!propertyKey || (properties.data ?? []).length === 0}
                            emptyMessage={propertyKey ? 'No events for this goal in this window.' : 'This goal carries no properties.'}
                        >
                            <Table variant="compact" flush stackAt="phone">
                                <Thead>
                                    <Tr>
                                        <Th scope="col">{propertyKey}</Th>
                                        <Th scope="col" width="shrink" numeric>Events</Th>
                                        <Th scope="col" width="shrink" numeric>Visitors</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {(properties.data ?? []).map(row => (
                                        <Tr key={row.value ?? '(not set)'}>
                                            <Td className={row.value === null ? styles.special : styles.code}>
                                                {row.value ?? '(not set)'}
                                            </Td>
                                            <Td label="Events" numeric>{numberFormatter.format(row.events)}</Td>
                                            <Td label="Visitors" numeric>{numberFormatter.format(row.visitors)}</Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        </PanelBody>
                    </Panel>
                </div>
            )}
        </section>
    );
}
