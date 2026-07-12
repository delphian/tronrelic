/**
 * PageActivity Component
 *
 * Per-page clickstream summaries for the two cookie-running audiences, rendered
 * as sibling tables on the Traffic tab:
 *
 * 1. Anonymous Visitor Activity — `page` events keyed on the cookieless traffic
 *    id (`tid`), for visitors who are not signed in.
 * 2. Registered User Activity — `page` events keyed on the Better Auth user id.
 *
 * Each row summarizes a subject's navigation in the window (page views, distinct
 * pages, first/last seen, last path) and expands to its full ordered page-hit
 * list — "every page they hit". Only interactive `page` events feed this; the
 * cookieless first-touch (`bootstrap`) stream, which includes bots, lives in the
 * VisitorAnalytics "Anonymous First Touches" table.
 *
 * Client-only admin tool: `/system/users` is admin-gated via the Better Auth
 * session cookie, so the SSR + Live Updates pattern does not apply — the
 * loading states here are the user-triggered fetch/pagination case the
 * pattern explicitly permits. Mirrors UsersMonitor / TrafficDashboard.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Button } from '../../../../../components/ui/Button';
import { adminGetPageActivity, adminGetPageHits } from '../../../api';
import type { AnalyticsPeriod, ICustomDateRange, IPageActivityRow, IPageHit, PageActivitySubject, VisitorPeriod } from '../../../api';
import { getDeviceIcon } from '../../../lib/deviceIcon';
import styles from './PageActivity.module.scss';

/** Rows per activity-table page. */
const PAGE_LIMIT = 25;

/** Max page hits fetched for a drill-down. */
const HITS_LIMIT = 200;

/**
 * The resolved lookback window passed to the API client: either a preset
 * period or a custom date range, derived from the page-level controls.
 */
export interface IActivityWindow {
    period?: VisitorPeriod;
    customRange?: ICustomDateRange;
}

interface IPageHitsRowProps {
    subject: PageActivitySubject;
    id: string;
    window: IActivityWindow;
}

/**
 * Expanded clickstream row for a single subject. Self-contained so each open
 * drill-down owns its fetch — mounting on expand and unmounting on collapse —
 * which eliminates the shared-state race where a late response from a
 * previously-open row could render under the currently-open one.
 *
 * @param props - The subject to fetch hits for and the active window.
 * @returns A table row spanning the parent's columns with the page-hit list.
 */
function PageHitsRow({ subject, id, window }: IPageHitsRowProps) {
    const [hits, setHits] = useState<IPageHit[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let active = true;
        /**
         * Fetch this subject's page hits, dropping the result if the row has
         * unmounted (collapsed or the table re-fetched) before it resolved.
         */
        const fetchHits = async (): Promise<void> => {
            setLoading(true);
            try {
                const result = await adminGetPageHits(subject, id, { ...window, limit: HITS_LIMIT });
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
    }, [subject, id, window]);

    return (
        <tr className={styles.detail_row}>
            <td colSpan={8}>
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
            </td>
        </tr>
    );
}

export interface IPageActivityTableProps {
    subject: PageActivitySubject;
    title: string;
    description: string;
    /** Column header for the subject id (e.g. "Traffic ID" / "Account"). */
    subjectHeading: string;
    /** Resolved lookback window from the page-level controls. */
    window: IActivityWindow;
}

/**
 * One subject's page-activity table with a per-row clickstream drill-down.
 * Exported so the combined Visitors explorer can render a single subject at a
 * time behind its subject selector, rather than the two stacked tables the
 * {@link PageActivity} wrapper renders.
 *
 * @param props - Table configuration and the global window.
 * @returns The rendered activity section.
 */
export function PageActivityTable({ subject, title, description, subjectHeading, window }: IPageActivityTableProps) {
    const [rows, setRows] = useState<IPageActivityRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);

    const [expandedId, setExpandedId] = useState<string | null>(null);

    // Window changes invalidate the page cursor and any open drill-down.
    useEffect(() => {
        setPage(1);
        setExpandedId(null);
    }, [window]);

    useEffect(() => {
        let active = true;
        /**
         * Fetch the activity page, dropping the result if a newer window/page
         * selection (or unmount) superseded this request before it resolved.
         */
        const fetchRows = async (): Promise<void> => {
            setLoading(true);
            try {
                const result = await adminGetPageActivity(subject, {
                    ...window,
                    limit: PAGE_LIMIT,
                    skip: (page - 1) * PAGE_LIMIT
                });
                if (active) {
                    setRows(result.rows ?? []);
                    setTotal(result.total ?? 0);
                }
            } catch (error) {
                console.error('Failed to fetch page activity:', error);
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
    }, [subject, window, page]);

    const totalPages = total > 0 ? Math.ceil(total / PAGE_LIMIT) : 1;

    /**
     * Toggle a row's page-hit drill-down open or closed. The expanded row owns
     * its own fetch (see {@link PageHitsRow}), so this only flips which row is
     * open — there is no shared hit state to race.
     *
     * @param id - The subject id of the row to expand or collapse.
     */
    const toggleExpand = useCallback((id: string): void => {
        setExpandedId(prev => (prev === id ? null : id));
    }, []);

    return (
        <div className={styles.section}>
            <div className={styles.section_header}>
                <h2 className={styles.section_title}>{title}</h2>
            </div>
            <p className="text-muted">{description}</p>

            {loading ? (
                <div className={styles.loading}>Loading activity…</div>
            ) : rows.length === 0 ? (
                <div className={styles.empty}>No page activity found in this period.</div>
            ) : (
                <>
                    <div className={styles.table_wrapper}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th>{subjectHeading}</th>
                                    <th>First Seen</th>
                                    <th>Last Seen</th>
                                    <th>Page Views</th>
                                    <th>Distinct Pages</th>
                                    <th>Last Path</th>
                                    <th>Device</th>
                                    <th><span className="text-muted">Pages</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => (
                                    <React.Fragment key={row.id}>
                                        <tr>
                                            <td className={styles.id_cell} title={row.id}>{row.id}</td>
                                            <td><ClientTime date={row.firstSeen} format="relative" /></td>
                                            <td><ClientTime date={row.lastSeen} format="relative" /></td>
                                            <td>{row.pageViews.toLocaleString()}</td>
                                            <td>{row.distinctPaths.toLocaleString()}</td>
                                            <td className={styles.path_cell} title={row.lastPath ?? undefined}>
                                                {row.lastPath || <span className={styles.muted}>—</span>}
                                            </td>
                                            <td className={styles.device_cell}>{getDeviceIcon(row.device)}</td>
                                            <td>
                                                <Button
                                                    size="xs"
                                                    variant="ghost"
                                                    onClick={() => toggleExpand(row.id)}
                                                    aria-expanded={expandedId === row.id}
                                                    aria-label={`${expandedId === row.id ? 'Hide' : 'View'} pages for ${row.id}`}
                                                >
                                                    {expandedId === row.id ? 'Hide' : 'View'}
                                                </Button>
                                            </td>
                                        </tr>
                                        {expandedId === row.id && (
                                            <PageHitsRow subject={subject} id={row.id} window={window} />
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
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
                            Page {page} of {totalPages} ({total.toLocaleString()} {total === 1 ? 'visitor' : 'visitors'})
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
        </div>
    );
}

interface IPageActivityProps {
    /** Selected lookback period from the page-level controls. */
    period: AnalyticsPeriod;
    /** Custom date range when `period === 'custom'`. */
    customRange?: ICustomDateRange;
}

/**
 * PageActivity renders the anonymous-tid and registered-user clickstream
 * tables, both governed by the page-level lookback window. Only interactive
 * `page` events feed these tables, so the bot filter does not apply —
 * non-JS crawlers never emit them.
 *
 * @param props - Global period and custom range selection.
 * @returns The rendered page-activity sections.
 */
export function PageActivity({ period, customRange }: IPageActivityProps) {
    // Memoized: the parent re-renders on live-counter polls, and a fresh
    // window identity would re-fire every table's fetch effect.
    const window = useMemo<IActivityWindow>(() => (
        period === 'custom'
            ? { customRange }
            : { period: period as VisitorPeriod }
    ), [period, customRange]);

    return (
        <div className={styles.container}>
            <PageActivityTable
                subject="tid"
                title="Anonymous Visitor Activity"
                subjectHeading="Traffic ID"
                description="Per-page navigation for cookied anonymous visitors, keyed on the traffic id. Expand a row to see every page they hit."
                window={window}
            />
            <PageActivityTable
                subject="user"
                title="Registered User Activity"
                subjectHeading="Account"
                description="Per-page navigation for signed-in accounts, keyed on the Better Auth user id. Expand a row to see every page they hit."
                window={window}
            />
        </div>
    );
}
