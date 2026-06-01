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
 * Client-only admin tool: `/system/users` is admin-gated and the token comes
 * from `SystemAuthContext` at runtime, so the SSR + Live Updates pattern does
 * not apply — the loading states here are the user-triggered fetch/pagination
 * case the pattern explicitly permits. Mirrors UsersMonitor / TrafficDashboard.
 */

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Button } from '../../../../../components/ui/Button';
import { adminGetPageActivity, adminGetPageHits } from '../../../api';
import type { IPageActivityRow, IPageHit, PageActivitySubject, VisitorPeriod } from '../../../api';
import { getDeviceIcon } from '../../../lib/deviceIcon';
import styles from './PageActivity.module.scss';

/** Period option labels for display. */
const PERIOD_LABELS: Record<VisitorPeriod, string> = {
    '24h': '24 Hours',
    '7d': '7 Days',
    '30d': '30 Days',
    '90d': '90 Days'
};

/** Rows per activity-table page. */
const PAGE_LIMIT = 25;

/** Max page hits fetched for a drill-down. */
const HITS_LIMIT = 200;

interface IPageHitsRowProps {
    token: string;
    subject: PageActivitySubject;
    id: string;
    period: VisitorPeriod;
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
function PageHitsRow({ token, subject, id, period }: IPageHitsRowProps) {
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
                const result = await adminGetPageHits(token, subject, id, { period, limit: HITS_LIMIT });
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
    }, [token, subject, id, period]);

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

interface IPageActivityTableProps {
    token: string;
    subject: PageActivitySubject;
    title: string;
    description: string;
    /** Column header for the subject id (e.g. "Traffic ID" / "Account"). */
    subjectHeading: string;
}

/**
 * One subject's page-activity table with a per-row clickstream drill-down.
 *
 * @param props - Table configuration.
 * @returns The rendered activity section.
 */
function PageActivityTable({ token, subject, title, description, subjectHeading }: IPageActivityTableProps) {
    const [period, setPeriod] = useState<VisitorPeriod>('24h');
    const [rows, setRows] = useState<IPageActivityRow[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);

    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        /**
         * Fetch the activity page, dropping the result if a newer period/page
         * selection (or unmount) superseded this request before it resolved.
         */
        const fetchRows = async (): Promise<void> => {
            setLoading(true);
            try {
                const result = await adminGetPageActivity(token, subject, {
                    period,
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
    }, [token, subject, period, page]);

    const totalPages = total > 0 ? Math.ceil(total / PAGE_LIMIT) : 1;

    /**
     * Change the lookback period and reset pagination + any open drill-down.
     *
     * @param next - The selected period.
     */
    const handlePeriodChange = (next: VisitorPeriod): void => {
        setPeriod(next);
        setPage(1);
        setExpandedId(null);
    };

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
                <div className={styles.toggle_group} role="group" aria-label={`${title} time period`}>
                    {(Object.keys(PERIOD_LABELS) as VisitorPeriod[]).map(option => (
                        <button
                            key={option}
                            className={`${styles.toggle_btn} ${period === option ? styles.toggle_btn__active : ''}`}
                            onClick={() => handlePeriodChange(option)}
                            aria-pressed={period === option}
                        >
                            {PERIOD_LABELS[option]}
                        </button>
                    ))}
                </div>
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
                                            <PageHitsRow token={token} subject={subject} id={row.id} period={period} />
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
    token: string;
}

/**
 * PageActivity renders the anonymous-tid and registered-user clickstream tables.
 *
 * @param props - Component props.
 * @param props.token - Admin authentication token for API requests.
 * @returns The rendered page-activity sections.
 */
export function PageActivity({ token }: IPageActivityProps) {
    return (
        <div className={styles.container}>
            <PageActivityTable
                token={token}
                subject="tid"
                title="Anonymous Visitor Activity"
                subjectHeading="Traffic ID"
                description="Per-page navigation for cookied anonymous visitors, keyed on the traffic id. Expand a row to see every page they hit."
            />
            <PageActivityTable
                token={token}
                subject="user"
                title="Registered User Activity"
                subjectHeading="Account"
                description="Per-page navigation for signed-in accounts, keyed on the Better Auth user id. Expand a row to see every page they hit."
            />
        </div>
    );
}
