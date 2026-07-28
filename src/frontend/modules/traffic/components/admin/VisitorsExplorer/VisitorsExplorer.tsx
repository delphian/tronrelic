/**
 * VisitorsExplorer Component
 *
 * The single table on the Traffic admin's Visitors tab: one row per visitor
 * (tid) in the window, carrying first-touch acquisition and in-window behaviour
 * together, with a per-row clickstream drill-down.
 *
 * Why one table, not three views. The tab previously offered "New visitors /
 * Anonymous / Registered" behind a selector, which read as three subsets of one
 * population but was not: new-vs-returning is a time property, anonymous-vs-
 * registered an identity property, and the two are orthogonal — a visitor can
 * be returning *and* registered, which no single view could say. Worse, two of
 * the three keyed on the tid while "Registered" keyed on the account, and the
 * bot filter reached only the first. Collapsing to one tid-keyed table turns
 * both distinctions into attributes of a row (`isNew`, `accountId`), gives the
 * bot filter one place to apply, and surfaces `botClass` and `channel`, which
 * are stored on every event row and were previously displayed nowhere.
 *
 * The tradeoff, taken deliberately: an account that browses from three browsers
 * is three rows sharing one account id, because the tid is the unit the Metrics
 * Contract defines a Visitor in and the only key an anonymous row has. Clicking
 * an account id filters the table to that account's tids, which is the
 * replacement for the per-account rollup the old Registered view provided.
 *
 * The row itself is the drill-down control — clicking anywhere on it expands
 * that visitor's clickstream. A `<tr>` is not natively focusable or
 * activatable, so the row supplies the `role`, `tabIndex`, key handling, and
 * focus ring a `<button>` would have carried; without them the drill-down
 * would be mouse-only.
 *
 * Client-only admin surface: `/system/traffic` is admin-gated via the Better
 * Auth session cookie, so the SSR + Live Updates pattern does not apply — the
 * loading states here are the user-triggered fetch/pagination case the pattern
 * explicitly permits.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Button } from '../../../../../components/ui/Button';
import { Card } from '../../../../../components/ui/Card';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Stack } from '../../../../../components/layout';
import { adminGetVisitors, adminGetFlaggedSubnets, adminGetPageHits } from '../../../api';
import type {
    AnalyticsPeriod, ICustomDateRange, IPageHit, IVisitorRow, VisitorPeriod
} from '../../../api';
import { getDeviceIcon } from '../../../lib/deviceIcon';
import styles from './VisitorsExplorer.module.scss';

/** Rows per table page. */
const PAGE_LIMIT = 25;

/** Max page hits fetched for a drill-down. */
const HITS_LIMIT = 200;

/** Column count, so the expanded drill-down row spans the full table. */
const COLUMN_COUNT = 10;

/**
 * The resolved lookback window passed to the API client: either a preset period
 * or a custom date range, derived from the page-level controls.
 */
interface IVisitorsWindow {
    period?: VisitorPeriod;
    customRange?: ICustomDateRange;
}

/**
 * Format UTM parameters into a readable summary string.
 *
 * @param utm - UTM parameters object or null.
 * @returns Formatted string like "google / cpc / spring_sale", or null when untagged.
 */
function formatUtm(utm: IVisitorRow['utm']): string | null {
    if (!utm) {
        return null;
    }

    const parts = [utm.source, utm.medium, utm.campaign].filter(Boolean);

    return parts.length > 0 ? parts.join(' / ') : null;
}

interface IPageHitsRowProps {
    id: string;
    window: IVisitorsWindow;
}

/**
 * Expanded clickstream row for a single visitor. Self-contained so each open
 * drill-down owns its fetch — mounting on expand and unmounting on collapse —
 * which eliminates the shared-state race where a late response from a
 * previously-open row could render under the currently-open one.
 *
 * @param props - The tid to fetch hits for and the active window.
 * @returns A table row spanning the parent's columns with the page-hit list.
 */
function PageHitsRow({ id, window }: IPageHitsRowProps) {
    const [hits, setHits] = useState<IPageHit[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        /**
         * Fetch this visitor's page hits, dropping the result if the row has
         * unmounted (collapsed or the table re-fetched) before it resolved.
         */
        const fetchHits = async (): Promise<void> => {
            setLoading(true);
            try {
                const result = await adminGetPageHits('tid', id, { ...window, limit: HITS_LIMIT });
                if (active) {
                    setHits(result);
                }
            } catch (error) {
                console.error('Failed to fetch page hits:', error);
                if (active) {
                    setHits([]);
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };
        fetchHits();
        return () => { active = false; };
    }, [id, window]);

    return (
        <Tr className={styles.detail_row}>
            <Td colSpan={COLUMN_COUNT}>
                {loading ? (
                    <div className={styles.loading}>Loading pages…</div>
                ) : hits.length === 0 ? (
                    <div className={styles.empty}>No page hits in this window.</div>
                ) : (
                    <>
                        <ol className={styles.hits}>
                            {hits.map((hit, index) => (
                                <li key={`${hit.timestamp}_${index}`} className={styles.hit}>
                                    <span className={styles.hit_time}>
                                        <ClientTime date={hit.timestamp} format="datetime" />
                                    </span>
                                    <code className={styles.hit_path}>{hit.path}</code>
                                    {hit.referer && (
                                        <span className={styles.hit_referer} title={hit.referer}>
                                            ← {hit.referer}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ol>
                        {hits.length >= HITS_LIMIT && (
                            <p className="text-muted">
                                Showing the newest {HITS_LIMIT} page hits — more exist in this window.
                            </p>
                        )}
                    </>
                )}
            </Td>
        </Tr>
    );
}

interface IVisitorsExplorerProps {
    /** Selected lookback period from the page-level controls. */
    period: AnalyticsPeriod;
    /** Custom date range when `period === 'custom'`. */
    customRange?: ICustomDateRange;
    /** Whether classified bot rows are included. */
    includeBots: boolean;
}

/**
 * Render the unified Visitors table with pagination, the high-volume-network
 * annotation, an optional account filter, and per-row clickstream expansion.
 *
 * @param props - The page-level window and bot filter.
 * @returns The rendered visitors section.
 */
export function VisitorsExplorer({ period, customRange, includeBots }: IVisitorsExplorerProps) {
    const [rows, setRows] = useState<IVisitorRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [accountFilter, setAccountFilter] = useState<string | null>(null);
    const [flaggedSubnets, setFlaggedSubnets] = useState<Set<string>>(new Set());

    // Memoized: the parent re-renders on live-counter polls, and a fresh window
    // identity would re-fire every fetch effect below.
    const window = useMemo<IVisitorsWindow>(() => (
        period === 'custom'
            ? { customRange }
            : { period: period as VisitorPeriod }
    ), [period, customRange]);

    // Window, bot filter, and account filter each invalidate the page cursor
    // and any open drill-down — the row under it may no longer be in the set.
    useEffect(() => {
        setPage(1);
        setExpandedId(null);
    }, [window, includeBots, accountFilter]);

    useEffect(() => {
        let active = true;
        /**
         * Fetch the visitor page, dropping the result if a newer selection (or
         * unmount) superseded this request before it resolved.
         */
        const fetchRows = async (): Promise<void> => {
            setLoading(true);
            try {
                const result = await adminGetVisitors({
                    ...window,
                    limit: PAGE_LIMIT,
                    skip: (page - 1) * PAGE_LIMIT,
                    excludeBots: !includeBots,
                    ...(accountFilter ? { accountId: accountFilter } : {})
                });
                if (active) {
                    setRows(result.rows ?? []);
                    setTotal(result.total ?? 0);
                }
            } catch (error) {
                console.error('Failed to fetch visitors:', error);
                if (active) {
                    setRows([]);
                    setTotal(0);
                }
            } finally {
                if (active) {
                    setLoading(false);
                }
            }
        };
        fetchRows();
        return () => { active = false; };
    }, [window, page, includeBots, accountFilter]);

    useEffect(() => {
        let active = true;
        /**
         * Load the high-volume source networks for the window so matching rows
         * can be badged. Failure is non-fatal — the annotation simply does not
         * render, because it never affects a count.
         */
        const fetchFlagged = async (): Promise<void> => {
            try {
                const flagged = await adminGetFlaggedSubnets({ period, customRange, limit: 50 });
                if (active) {
                    setFlaggedSubnets(new Set(flagged.map(f => f.subnetHash)));
                }
            } catch (error) {
                console.error('Failed to fetch flagged subnets:', error);
            }
        };
        fetchFlagged();
        return () => { active = false; };
    }, [period, customRange]);

    const totalPages = total > 0 ? Math.ceil(total / PAGE_LIMIT) : 1;

    /**
     * Toggle a row's page-hit drill-down open or closed. The expanded row owns
     * its own fetch (see {@link PageHitsRow}), so this only flips which row is
     * open — there is no shared hit state to race.
     *
     * @param id - The tid of the row to expand or collapse.
     */
    const toggleExpand = useCallback((id: string): void => {
        setExpandedId(prev => (prev === id ? null : id));
    }, []);

    /**
     * Keyboard equivalent of clicking the row. A `<tr>` is not natively
     * focusable or activatable, so making the whole row the control means
     * supplying what a `<button>` would have given for free — otherwise the
     * drill-down becomes mouse-only. Space is intercepted to stop the page
     * scrolling underneath the expansion.
     *
     * @param event - The keyboard event from the focused row.
     * @param id - The tid of the row to expand or collapse.
     */
    const handleRowKeyDown = useCallback((event: React.KeyboardEvent<HTMLTableRowElement>, id: string): void => {
        if (event.key !== 'Enter' && event.key !== ' ') {
            return;
        }
        // A nested control (the account filter button) handles its own keys;
        // without this the row would also toggle behind it.
        if (event.target !== event.currentTarget) {
            return;
        }
        event.preventDefault();
        toggleExpand(id);
    }, [toggleExpand]);

    return (
        <Stack gap="lg" className={styles.container}>
            <Card tone="muted" padding="sm" className={styles.section}>
                <div className={styles.section_header}>
                    <h2 className={styles.section_title}>Visitors</h2>
                </div>
                <p className="text-muted">
                    One row per visitor in this window. A visitor is a tid that loaded a page (ran
                    JavaScript), so cookieless bots that never run JS are excluded here and from every
                    visitor count. The Visitor column shows the account when the visitor signed in,
                    otherwise the traffic id; an asterisk marks a visitor whose first-ever contact
                    falls inside this window. Acquisition columns read the visitor&apos;s first
                    server-recorded hit, whenever that was — so a returning visitor still shows where
                    they originally came from. Select a row to see every page that visitor hit.{' '}
                    {includeBots
                        ? 'JavaScript-running bots the classifier caught are included; referrers are client-supplied and often spoofed.'
                        : 'Known bots are excluded — unclassified visitors are kept, so this is not "humans only".'}
                </p>

                {flaggedSubnets.size > 0 && (
                    <p className={styles.flagged_note}>
                        <AlertTriangle size={14} aria-hidden="true" />
                        {flaggedSubnets.size.toLocaleString()} high-volume source{' '}
                        {flaggedSubnets.size === 1 ? 'network' : 'networks'} flagged as possible
                        automated traffic — rows from a flagged network are marked in the Source
                        column. These are not excluded from any count: a busy office, VPN, or mobile
                        carrier can also concentrate many real visitors behind one network.
                    </p>
                )}

                {accountFilter && (
                    <p className={styles.filter_note}>
                        <span>
                            Filtered to every traffic id used by account <code>{accountFilter}</code>.
                        </span>
                        <Button size="xs" variant="ghost" onClick={() => setAccountFilter(null)}>
                            <X size={12} aria-hidden="true" /> Clear
                        </Button>
                    </p>
                )}

                {loading ? (
                    <div className={styles.loading}>Loading visitors…</div>
                ) : rows.length === 0 ? (
                    <div className={styles.empty}>No visitors found in this period.</div>
                ) : (
                    <>
                        <div className={styles.table_wrapper}>
                            <Table>
                                <Thead>
                                    <Tr>
                                        <Th scope="col">Visitor</Th>
                                        <Th scope="col">First Seen</Th>
                                        <Th scope="col">Last Seen</Th>
                                        <Th scope="col">Views</Th>
                                        <Th scope="col">Paths</Th>
                                        <Th scope="col">Channel</Th>
                                        <Th scope="col">Source</Th>
                                        <Th scope="col">Landing</Th>
                                        <Th scope="col">Country</Th>
                                        <Th scope="col">Device</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {rows.map(row => {
                                        const utm = formatUtm(row.utm);
                                        const isFlagged = Boolean(row.subnetHash && flaggedSubnets.has(row.subnetHash));
                                        const accountId = row.accountId;
                                        return (
                                            <React.Fragment key={row.id}>
                                                <Tr
                                                    className={styles.row}
                                                    // Keeps the open row tinted now that the View/Hide
                                                    // button no longer marks which one is expanded.
                                                    isExpanded={expandedId === row.id}
                                                    onClick={() => toggleExpand(row.id)}
                                                    onKeyDown={event => handleRowKeyDown(event, row.id)}
                                                    tabIndex={0}
                                                    role="button"
                                                    aria-expanded={expandedId === row.id}
                                                    aria-label={`${expandedId === row.id ? 'Hide' : 'Show'} pages for ${row.id}`}
                                                >
                                                    <Td className={styles.id_cell} title={row.id}>
                                                        <span className={styles.id_inner}>
                                                            {/* Decorative: the accessible labels below carry "new visitor" in words. */}
                                                            {row.isNew && (
                                                                <span className={styles.new_marker} aria-hidden="true">*</span>
                                                            )}
                                                            {accountId ? (
                                                                <button
                                                                    type="button"
                                                                    className={styles.account_link}
                                                                    // The row itself toggles the drill-down, so this nested
                                                                    // control must stop the event or filtering by account
                                                                    // would also expand the row it was clicked in.
                                                                    onClick={event => {
                                                                        event.stopPropagation();
                                                                        setAccountFilter(accountId);
                                                                    }}
                                                                    aria-label={`Filter to account ${accountId}${row.isNew ? ' (new visitor)' : ''}`}
                                                                >
                                                                    {accountId}
                                                                </button>
                                                            ) : (
                                                                <span
                                                                    className={styles.id_value}
                                                                    aria-label={row.isNew ? `${row.id} (new visitor)` : undefined}
                                                                >
                                                                    {row.id}
                                                                </span>
                                                            )}
                                                            {row.botClass && row.botClass !== 'human' && (
                                                                <span className={styles.bot_tag}>{row.botClass}</span>
                                                            )}
                                                        </span>
                                                    </Td>
                                                    <Td><ClientTime date={row.firstSeen} format="relative" /></Td>
                                                    <Td><ClientTime date={row.lastSeen} format="relative" /></Td>
                                                    <Td>{row.pageViews.toLocaleString()}</Td>
                                                    <Td>{row.distinctPaths.toLocaleString()}</Td>
                                                    <Td className={styles.channel_cell}>
                                                        {row.channel || <span className={styles.muted}>—</span>}
                                                    </Td>
                                                    <Td className={styles.source_cell}>
                                                        <span className={styles.source_inner}>
                                                            <span className={styles.source_value} title={row.referrerDomain ?? 'direct'}>
                                                                {row.referrerDomain || 'direct'}
                                                            </span>
                                                            {utm && <span className={styles.utm} title={utm}>{utm}</span>}
                                                            {isFlagged && (
                                                                <AlertTriangle
                                                                    size={14}
                                                                    className={styles.flag_icon}
                                                                    aria-label="High-volume source network"
                                                                />
                                                            )}
                                                        </span>
                                                    </Td>
                                                    <Td className={styles.path_cell} title={row.landingPage ?? undefined}>
                                                        {row.landingPage || <span className={styles.muted}>—</span>}
                                                    </Td>
                                                    <Td className={styles.country_cell}>
                                                        {row.country || <span className={styles.muted}>—</span>}
                                                    </Td>
                                                    <Td className={styles.device_cell}>{getDeviceIcon(row.device)}</Td>
                                                </Tr>
                                                {expandedId === row.id && (
                                                    <PageHitsRow id={row.id} window={window} />
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </Tbody>
                            </Table>
                        </div>

                        <div className={styles.pagination}>
                            <Button
                                onClick={() => setPage(page - 1)}
                                disabled={page <= 1}
                                size="sm"
                                variant="ghost"
                            >
                                Previous
                            </Button>
                            <span className={styles.page_info}>
                                Page {page} of {totalPages} ({total.toLocaleString()}{' '}
                                {total === 1 ? 'visitor' : 'visitors'})
                            </span>
                            <Button
                                onClick={() => setPage(page + 1)}
                                disabled={page >= totalPages}
                                size="sm"
                                variant="ghost"
                            >
                                Next
                            </Button>
                        </div>
                    </>
                )}
            </Card>
        </Stack>
    );
}
