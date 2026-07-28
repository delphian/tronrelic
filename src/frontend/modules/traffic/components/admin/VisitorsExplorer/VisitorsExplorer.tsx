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
 * Expanding a row publishes that visitor's *complete* record — every stored
 * attribute for the tid and its account, then the clickstream. That is what
 * makes the responsive rule safe: at tablet width and below the table drops
 * First Seen, Channel, and Device (see `.col_optional`), and none of it becomes
 * unreachable because the panel already carries all of it at every width.
 *
 * Clicking anywhere on a row expands that visitor's detail. The row stays
 * a real `<tr>`: giving it `role="button"` would make every `<td>` descendant
 * presentational, orphaning the cell/header relationships so a screen reader
 * hears only the row's label instead of its ten columns — and it would nest the
 * account-filter button inside an ARIA button, which is invalid. So the row
 * click is a mouse affordance, and a chevron disclosure button in the first
 * cell carries the keyboard and assistive-technology path.
 *
 * Client-only admin surface: `/system/traffic` is admin-gated via the Better
 * Auth session cookie, so the SSR + Live Updates pattern does not apply — the
 * loading states here are the user-triggered fetch/pagination case the pattern
 * explicitly permits.
 */

'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, X } from 'lucide-react';
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

/**
 * Column count, so the expanded drill-down row spans the full table.
 *
 * Counts every column the header declares, including the three the container
 * query hides at tablet width and below. Those columns still exist in the table
 * model, so a smaller colSpan would leave the detail cell short of the right
 * edge at wide widths; the hidden columns carry no content, so spanning them at
 * narrow widths costs nothing.
 */
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

/**
 * Format every stored UTM field for the expanded detail panel.
 *
 * The detail panel claims to publish the complete stored record, so it cannot
 * use {@link formatUtm} — that summary deliberately drops `term` and `content`
 * to keep the table's Source column narrow, which would hide keyword/creative
 * attribution and render a term-or-content-only first touch as untagged. Fields
 * are labelled because the positional `a / b / c` form becomes ambiguous once
 * nulls are filtered out of a five-part list.
 *
 * @param utm - UTM parameters object from the visitors read, or null when the
 *   first-touch row carried no campaign tags at all.
 * @returns Labelled string like "source=google, medium=cpc, term=trx", or null
 *   when no field holds a value so the caller can render its placeholder.
 */
function formatUtmDetail(utm: IVisitorRow['utm']): string | null {
    if (!utm) {
        return null;
    }

    const parts = ([
        ['source', utm.source],
        ['medium', utm.medium],
        ['campaign', utm.campaign],
        ['term', utm.term],
        ['content', utm.content]
    ] as const)
        .filter(([, value]) => Boolean(value))
        .map(([label, value]) => `${label}=${value}`);

    return parts.length > 0 ? parts.join(', ') : null;
}

interface IDetailFieldProps {
    label: string;
    children: React.ReactNode;
}

/**
 * One label/value pair in the expanded row's attribute grid.
 *
 * A `<dt>`/`<dd>` pair rather than two `<div>`s: the panel is a set of
 * name-value pairs about one subject, which is exactly what a definition list
 * conveys to a screen reader — a grid of anonymous divs would read as a wall of
 * unassociated text.
 *
 * @param props - The field's label and its already-formatted value node.
 * @returns The paired term and description.
 */
function DetailField({ label, children }: IDetailFieldProps) {
    return (
        <div className={styles.detail_field}>
            <dt className={styles.detail_label}>{label}</dt>
            <dd className={styles.detail_value}>{children}</dd>
        </div>
    );
}

interface IVisitorDetailRowProps {
    row: IVisitorRow;
    isFlagged: boolean;
    window: IVisitorsWindow;
}

/**
 * Expanded detail row for a single visitor: every stored attribute for the tid
 * (and its account, when it has one) followed by the page-hit clickstream.
 *
 * Carrying the full attribute set here is what lets the table hide its three
 * lowest-value columns on narrow viewports without the data becoming
 * unreachable — the panel is the canonical place a visitor's complete record is
 * readable, at every width, so nothing is only visible on a wide screen.
 *
 * Self-contained fetch so each open drill-down owns its request — mounting on
 * expand and unmounting on collapse — which eliminates the shared-state race
 * where a late response from a previously-open row could render under the
 * currently-open one.
 *
 * @param props - The visitor row to describe, whether its source network was
 *   flagged high-volume, and the active window scoping the clickstream.
 * @returns A table row spanning the parent's columns with attributes and hits.
 */
function VisitorDetailRow({ row, isFlagged, window }: IVisitorDetailRowProps) {
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
                const result = await adminGetPageHits('tid', row.id, { ...window, limit: HITS_LIMIT });
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
    }, [row.id, window]);

    const utm = formatUtmDetail(row.utm);
    /** Placeholder for an attribute the visitor has no value for. */
    const none = <span className={styles.muted}>—</span>;

    return (
        <Tr className={styles.detail_row}>
            <Td colSpan={COLUMN_COUNT}>
                <div className={styles.detail}>
                    <section>
                        <h3 className={styles.detail_section_title}>Visitor detail</h3>
                        <dl className={styles.detail_grid}>
                            <DetailField label="Traffic id">
                                <code className={styles.detail_mono}>{row.id}</code>
                            </DetailField>
                            <DetailField label="Account">
                                {row.accountId
                                    ? <code className={styles.detail_mono}>{row.accountId}</code>
                                    : <span className={styles.muted}>anonymous</span>}
                            </DetailField>
                            <DetailField label="Visitor type">
                                {row.isNew ? 'New in this window' : 'Returning'}
                            </DetailField>
                            <DetailField label="Classification">
                                {row.botClass
                                    ? (row.botClass === 'human'
                                        ? 'human'
                                        : <span className={styles.bot_tag}>{row.botClass}</span>)
                                    : <span className={styles.muted}>unclassified</span>}
                            </DetailField>
                            <DetailField label="First seen">
                                <ClientTime date={row.firstSeen} format="datetime" />
                            </DetailField>
                            <DetailField label="Last seen">
                                <ClientTime date={row.lastSeen} format="datetime" />
                            </DetailField>
                            <DetailField label="Page views">{row.pageViews.toLocaleString()}</DetailField>
                            <DetailField label="Distinct paths">{row.distinctPaths.toLocaleString()}</DetailField>
                            <DetailField label="Channel">{row.channel || none}</DetailField>
                            <DetailField label="Source">
                                {row.referrerDomain || 'direct'}
                                {isFlagged && (
                                    <span className={styles.detail_flag}>
                                        <AlertTriangle size={14} aria-hidden="true" />
                                        high-volume network
                                    </span>
                                )}
                            </DetailField>
                            <DetailField label="Campaign (UTM)">{utm || none}</DetailField>
                            <DetailField label="Landing page">
                                {row.landingPage
                                    ? <code className={styles.detail_mono}>{row.landingPage}</code>
                                    : none}
                            </DetailField>
                            <DetailField label="Last path">
                                {row.lastPath
                                    ? <code className={styles.detail_mono}>{row.lastPath}</code>
                                    : none}
                            </DetailField>
                            <DetailField label="Country">{row.country || none}</DetailField>
                            <DetailField label="Device">
                                <span className={styles.detail_device}>
                                    {getDeviceIcon(row.device)} {row.device}
                                </span>
                            </DetailField>
                            <DetailField label="Source network">
                                {row.subnetHash
                                    ? <code className={styles.detail_mono}>{row.subnetHash}</code>
                                    : none}
                            </DetailField>
                        </dl>
                    </section>

                    <section>
                        <h3 className={styles.detail_section_title}>Pages hit</h3>
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
                    </section>
                </div>
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
     * its own fetch (see {@link VisitorDetailRow}), so this only flips which row is
     * open — there is no shared hit state to race.
     *
     * @param id - The tid of the row to expand or collapse.
     */
    const toggleExpand = useCallback((id: string): void => {
        setExpandedId(prev => (prev === id ? null : id));
    }, []);

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
                    they originally came from. Select a row to see that visitor&apos;s full record and
                    every page they hit — on narrower screens some columns move there instead.{' '}
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
                                        <Th scope="col" className={styles.col_optional}>First Seen</Th>
                                        <Th scope="col">Last Seen</Th>
                                        <Th scope="col">Views</Th>
                                        <Th scope="col">Paths</Th>
                                        <Th scope="col" className={styles.col_optional}>Channel</Th>
                                        <Th scope="col">Source</Th>
                                        <Th scope="col">Landing</Th>
                                        <Th scope="col">Country</Th>
                                        <Th scope="col" className={styles.col_optional}>Device</Th>
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
                                                    // Mouse-only convenience. The row stays a real <tr> —
                                                    // role="button" would make every <td> presentational and
                                                    // orphan the cell/header relationships — so the keyboard
                                                    // and screen-reader path is the disclosure button below.
                                                    onClick={() => toggleExpand(row.id)}
                                                >
                                                    <Td className={styles.id_cell} title={row.id}>
                                                        <span className={styles.id_inner}>
                                                            {/* The accessible drill-down control: a chevron, not the
                                                                removed View/Hide button, but a real focusable element
                                                                so expanding is not mouse-only. */}
                                                            <button
                                                                type="button"
                                                                className={styles.disclosure}
                                                                // The row also toggles, so stop the event or the
                                                                // click would toggle twice and cancel itself out.
                                                                onClick={event => {
                                                                    event.stopPropagation();
                                                                    toggleExpand(row.id);
                                                                }}
                                                                aria-expanded={expandedId === row.id}
                                                                aria-label={`${expandedId === row.id ? 'Hide' : 'Show'} pages for ${row.id}`}
                                                            >
                                                                {expandedId === row.id
                                                                    ? <ChevronDown size={14} aria-hidden="true" />
                                                                    : <ChevronRight size={14} aria-hidden="true" />}
                                                            </button>
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
                                                    <Td className={styles.col_optional}>
                                                        <ClientTime date={row.firstSeen} format="relative" />
                                                    </Td>
                                                    <Td><ClientTime date={row.lastSeen} format="relative" /></Td>
                                                    <Td>{row.pageViews.toLocaleString()}</Td>
                                                    <Td>{row.distinctPaths.toLocaleString()}</Td>
                                                    <Td className={`${styles.channel_cell} ${styles.col_optional}`}>
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
                                                    <Td className={`${styles.device_cell} ${styles.col_optional}`}>
                                                        {getDeviceIcon(row.device)}
                                                    </Td>
                                                </Tr>
                                                {expandedId === row.id && (
                                                    <VisitorDetailRow
                                                        row={row}
                                                        isFlagged={isFlagged}
                                                        window={window}
                                                    />
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
