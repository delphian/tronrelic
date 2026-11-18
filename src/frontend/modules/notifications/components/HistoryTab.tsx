'use client';

/**
 * @fileoverview History tab of /system/notifications: the audit feed of every
 * notification blast, newest first.
 *
 * The audit keeps every blast for its retention window, which runs to
 * thousands of rows, so the feed is paged on the server 25 rows at a time and
 * narrowed by category and source, the two filters the history endpoint
 * accepts. The filter choices come from the registered categories, the same
 * list the Categories tab shows, so each category offers its own id and each
 * distinct source appears once. Labels and counts in each row are snapshots
 * taken when the blast fired, so a row stays readable after the plugin that
 * fired it, and its category, are gone. Client component behind the
 * admin-gated page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { NotificationSeverity } from '@/types';
import { Stack } from '../../../components/layout';
import { Badge, type BadgeTone } from '../../../components/ui/Badge';
import { ClientTime } from '../../../components/ui/ClientTime';
import { Field } from '../../../components/ui/Field';
import { Pagination } from '../../../components/ui/Pagination';
import { Panel } from '../../../components/ui/Panel';
import { Select } from '../../../components/ui/Select';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../components/ui/Table';
import { getAdminCategories, getHistory, type IAdminCategory, type IAuditRecordView } from '../api/notifications.api';
import { RowLabel } from './RowLabel';
import styles from './admin.module.scss';

/** Rows per page of the feed. */
const HISTORY_PAGE_SIZE = 25;

/** Columns in the feed, for the full-width empty row. */
const HISTORY_COLUMNS = 7;

/** Badge tone per severity — `'error'` reads as the danger tone. */
const SEVERITY_TONE: Record<NotificationSeverity, BadgeTone> = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    error: 'danger'
};

/**
 * The two filters the history endpoint accepts. An empty string means the
 * filter is off, which is also the value of each select's "All" option.
 */
interface IHistoryFilter {
    /** Category id the rows must have, or blank for every category. */
    categoryId: string;
    /** Source the rows must come from, or blank for every source. */
    source: string;
}

/** The feed with no filter applied, which the tab opens on. */
const NO_FILTER: IHistoryFilter = { categoryId: '', source: '' };

/**
 * Describe the rows on screen and how many match, for the line beside the
 * pager.
 *
 * @param page - The page shown, counting from 1.
 * @param shown - Rows on that page.
 * @param total - Rows across every page for the current filters.
 * @param filtered - Whether a filter is applied, so the sentence says the count is a subset.
 * @returns A sentence such as "26–50 of 1,284 notifications".
 */
function describeRange(page: number, shown: number, total: number, filtered: boolean): string {
    const first = (page - 1) * HISTORY_PAGE_SIZE + 1;
    const count = total.toLocaleString('en-US');
    const range = shown === 0 ? `0 of ${count}` : `${first.toLocaleString('en-US')}–${(first + shown - 1).toLocaleString('en-US')} of ${count}`;
    const noun = total === 1 ? 'notification' : 'notifications';
    return filtered ? `${range} ${noun} matching the filters` : `${range} ${noun}`;
}

/**
 * The total delivered across every channel of one blast. The audit records a
 * count per channel, and the feed shows one figure.
 *
 * @param record - The audit row.
 * @returns How many deliveries succeeded.
 */
function deliveredCount(record: IAuditRecordView): number {
    return record.channels.reduce((sum, channel) => sum + channel.delivered, 0);
}

/**
 * Admin History tab — the paged, filterable audit feed.
 *
 * @returns The history panel and its pager.
 */
export function HistoryTab(): React.ReactElement {
    const [records, setRecords] = useState<IAuditRecordView[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [filter, setFilter] = useState<IHistoryFilter>(NO_FILTER);
    const [categories, setCategories] = useState<IAdminCategory[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [categoriesError, setCategoriesError] = useState<string | null>(null);
    const latestRequest = useRef(0);

    const filtered = filter.categoryId !== '' || filter.source !== '';

    /** Every distinct source among the registered categories, alphabetically. */
    const sourceOptions = useMemo(
        () => Array.from(new Set(categories.map((category) => category.source))).sort(),
        [categories]
    );

    /**
     * The categories the category filter offers, alphabetically by label. With
     * a source chosen, only that source's categories are listed, since any
     * other choice would match nothing.
     */
    const categoryOptions = useMemo(
        () => categories
            .filter((category) => filter.source === '' || category.source === filter.source)
            .sort((a, b) => a.label.localeCompare(b.label)),
        [categories, filter.source]
    );

    /**
     * Fetch one page of the feed for a set of filters and show it.
     *
     * Requests are numbered, and only the answer to the newest one is shown,
     * so a slow answer for an earlier filter cannot replace the rows of the
     * filter chosen after it.
     *
     * @param nextPage - The page to show, counting from 1.
     * @param nextFilter - The filters the rows must match.
     */
    const load = useCallback(async (nextPage: number, nextFilter: IHistoryFilter): Promise<void> => {
        const request = ++latestRequest.current;
        setLoading(true);
        try {
            const result = await getHistory({
                categoryId: nextFilter.categoryId || undefined,
                source: nextFilter.source || undefined,
                limit: HISTORY_PAGE_SIZE,
                skip: (nextPage - 1) * HISTORY_PAGE_SIZE
            });
            if (request === latestRequest.current) {
                setRecords(result.records);
                setTotal(result.total);
                setPage(nextPage);
                setError(null);
            }
        } catch (err) {
            if (request === latestRequest.current) {
                setError(err instanceof Error ? err.message : 'Failed to load history');
            }
        } finally {
            if (request === latestRequest.current) {
                setLoading(false);
                setLoaded(true);
            }
        }
    }, []);

    /** Load the newest page, unfiltered, once the tab opens. */
    useEffect(() => {
        void load(1, NO_FILTER);
    }, [load]);

    /**
     * Load the registered categories the filters are built from. A failure
     * leaves only the "All" choices and says why, without hiding the feed.
     *
     * @returns Cleanup that ignores an answer arriving after the tab closed.
     */
    useEffect(() => {
        let cancelled = false;
        getAdminCategories().then(
            /**
             * Keep the categories for the filter choices.
             *
             * @param rows - The registered categories.
             */
            (rows) => {
                if (!cancelled) {
                    setCategories(rows);
                }
            },
            /**
             * Report that the filter choices could not be read.
             *
             * @param err - Why the categories could not be read.
             */
            (err: unknown) => {
                if (!cancelled) {
                    setCategoriesError(err instanceof Error ? err.message : 'Failed to load categories');
                }
            }
        );
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * Narrow the feed to one category, or every category, from the first page.
     *
     * @param categoryId - The chosen category id, or blank for every category.
     */
    const handleCategoryChange = useCallback((categoryId: string): void => {
        const next = { ...filter, categoryId };
        setFilter(next);
        void load(1, next);
    }, [filter, load]);

    /**
     * Narrow the feed to one source, or every source, from the first page. A
     * chosen category from another source is cleared, because together the two
     * filters would match nothing.
     *
     * @param source - The chosen source, or blank for every source.
     */
    const handleSourceChange = useCallback((source: string): void => {
        const category = categories.find((entry) => entry.id === filter.categoryId);
        const keepCategory = source === '' || category === undefined || category.source === source;
        const next = { source, categoryId: keepCategory ? filter.categoryId : '' };
        setFilter(next);
        void load(1, next);
    }, [categories, filter, load]);

    /**
     * Show another page under the same filters.
     *
     * @param nextPage - The page the pager asked for.
     */
    const handlePageChange = useCallback((nextPage: number): void => {
        void load(nextPage, filter);
    }, [filter, load]);

    const filters = (
        <div className={styles.filters}>
            <Field inline label="Category">
                <Select value={filter.categoryId} onChange={(event) => handleCategoryChange(event.target.value)}>
                    <option value="">All categories</option>
                    {categoryOptions.map((category) => (
                        <option key={category.id} value={category.id}>{category.label}</option>
                    ))}
                </Select>
            </Field>
            <Field inline label="Source">
                <Select value={filter.source} onChange={(event) => handleSourceChange(event.target.value)}>
                    <option value="">All sources</option>
                    {sourceOptions.map((source) => (
                        <option key={source} value={source}>{source}</option>
                    ))}
                </Select>
            </Field>
        </div>
    );

    let content: ReactNode;
    if (!loaded) {
        content = <p className={styles.placeholder}>Loading history…</p>;
    } else {
        content = (
            <Table variant="compact" flush stackAt="mobile">
                <Thead>
                    <Tr>
                        <Th width="shrink">When</Th>
                        <Th width="shrink">Severity</Th>
                        <Th width="expand">Notification</Th>
                        <Th width="shrink">Category</Th>
                        <Th width="shrink" numeric>Delivered</Th>
                        <Th width="shrink" numeric>Suppressed</Th>
                        <Th width="shrink" numeric>Targeted</Th>
                    </Tr>
                </Thead>
                <Tbody>
                    {records.length === 0 && (
                        <Tr>
                            <Td colSpan={HISTORY_COLUMNS} muted>
                                {filtered ? 'No notifications match these filters.' : 'No notifications have been sent yet.'}
                            </Td>
                        </Tr>
                    )}
                    {records.map((record) => (
                        <Tr key={record.id}>
                            <Td><ClientTime date={record.createdAt} format="short" /></Td>
                            <Td><Badge tone={SEVERITY_TONE[record.severity]} size="xs">{record.severity}</Badge></Td>
                            <Td><RowLabel name={record.title} description={record.body} clamp /></Td>
                            <Td label="Category" title={`Source: ${record.source}`}>{record.categoryLabel}</Td>
                            <Td label="Delivered" numeric>{deliveredCount(record)}</Td>
                            <Td label="Suppressed" numeric>{record.suppressedCount}</Td>
                            <Td label="Targeted" numeric>{record.recipientCount}</Td>
                        </Tr>
                    ))}
                </Tbody>
            </Table>
        );
    }

    return (
        <Stack gap="sm">
            <Panel title="History" meta={loading ? 'Loading…' : 'One row per blast, newest first.'} actions={filters}>
                {categoriesError && <p className={styles.error} role="alert">The filters could not be loaded: {categoriesError}</p>}
                {error && <p className={styles.error} role="alert">{error}</p>}
                {content}
            </Panel>
            {total > 0 && (
                <div className={styles.footer}>
                    <span className={styles.range} aria-live="polite">{describeRange(page, records.length, total, filtered)}</span>
                    <Pagination total={total} pageSize={HISTORY_PAGE_SIZE} currentPage={page} onPageChange={handlePageChange} />
                </div>
            )}
        </Stack>
    );
}
