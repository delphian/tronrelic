'use client';

/**
 * ClickHouse table browser component for the system console.
 *
 * Mirrors CollectionBrowser (the MongoDB equivalent) so admins get the
 * same expand-then-paginate experience for analytical tables. Differences
 * from the Mongo browser: rows have no stable `_id`, so expansion uses
 * the row's position in the page; deletion is not exposed because
 * `ALTER TABLE ... DELETE` is async and dangerous in ClickHouse — viewing
 * is the only operation needed for ops debugging.
 *
 * The inventory is a real table with sortable columns for the same reason the
 * Mongo browser is: row count and stored size are quantities an operator
 * compares across tables — which one is eating disk, which one explains a slow
 * query — and a column of right-aligned figures answers that by scanning, where
 * badges scattered along each row do not.
 */

import { useState, useEffect, useCallback, useMemo, Fragment } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { CopyButton } from '../../../../components/ui/CopyButton';
import type { IClickHouseTableBrowserProps } from '@/types';
import { formatBytes } from '../../../../lib/format';
import {
    AlertCircle,
    ArrowDown,
    ArrowUp,
    ArrowUpDown,
    ChevronDown,
    ChevronRight
} from 'lucide-react';
import styles from './ClickHouseTableBrowser.module.scss';

interface ITableStat {
    name: string;
    rowCount: number;
    sizeBytes: number;
    engine: string;
}

/** A column the table inventory can be ranked by. */
type TableSortKey = 'name' | 'rowCount' | 'sizeBytes' | 'engine';

/** Which way a sorted column runs. */
type SortDirection = 'asc' | 'desc';

/**
 * The column the inventory is ranked by, and the direction it runs in.
 */
interface ITableSort {
    /** The ranked column. */
    key: TableSortKey;
    /** `asc` puts the smallest first, `desc` the largest. */
    direction: SortDirection;
}

/**
 * The sortable columns of the table inventory.
 *
 * `initialDirection` is what a first click on a column produces. The numeric
 * columns open descending because the question an operator brings here is
 * nearly always "what is biggest", and making them click twice to reach that
 * would be a step for nothing. The text columns open ascending, which is plain
 * alphabetical order.
 */
const TABLE_COLUMNS: ReadonlyArray<{
    key: TableSortKey;
    label: string;
    numeric: boolean;
    initialDirection: SortDirection;
}> = [
    { key: 'name', label: 'Table', numeric: false, initialDirection: 'asc' },
    { key: 'rowCount', label: 'Rows', numeric: true, initialDirection: 'desc' },
    { key: 'sizeBytes', label: 'Size', numeric: true, initialDirection: 'desc' },
    { key: 'engine', label: 'Engine', numeric: false, initialDirection: 'asc' }
];

/** Where the inventory rests before the operator sorts it: alphabetical by name. */
const DEFAULT_SORT: ITableSort = { key: 'name', direction: 'asc' };

/**
 * Order two tables by the active column.
 *
 * Names and engines compare with `localeCompare` so the alphabetical view
 * matches what a reader expects of mixed-case, prefixed identifiers; every
 * other column is a plain number. Direction is applied by negating the
 * comparison, so one comparator serves both directions instead of two
 * near-identical ones.
 *
 * @param a - Left-hand table.
 * @param b - Right-hand table.
 * @param sort - The active column and direction.
 * @returns Negative, zero, or positive per the `Array.prototype.sort` contract.
 */
function compareTables(a: ITableStat, b: ITableStat, sort: ITableSort): number {
    const ordering = sort.key === 'name' || sort.key === 'engine'
        ? a[sort.key].localeCompare(b[sort.key])
        : a[sort.key] - b[sort.key];

    return sort.direction === 'asc' ? ordering : -ordering;
}

interface IClickHouseStats {
    dbName: string;
    totalSize: number;
    tables: ITableStat[];
}

interface IPaginatedRows {
    rows: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

/**
 * Render the ClickHouse table browser.
 *
 * @param prefix - Namespace to scope to; omit for every table in the database.
 * @param title - Heading above the list. Omitted by default because the
 * embedding page — the system console included — usually supplies its own, and
 * a built-in heading would read as a duplicate.
 * @param hideWhenEmpty - Render nothing when no table matches, rather than an
 * empty panel that reads as missing data.
 */
export function ClickHouseTableBrowser({
    prefix,
    title,
    hideWhenEmpty = false
}: IClickHouseTableBrowserProps) {
    const [stats, setStats] = useState<IClickHouseStats | null>(null);
    const [sort, setSort] = useState<ITableSort>(DEFAULT_SORT);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedTable, setExpandedTable] = useState<string | null>(null);
    const [rows, setRows] = useState<IPaginatedRows | null>(null);
    const [loadingRows, setLoadingRows] = useState(false);
    const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

    const fetchStats = useCallback(async () => {
        try {
            setLoading(true);
            // The prefix travels as a query parameter so the server filters in
            // SQL — an embedded caller never receives the wider table list.
            const query = typeof prefix === 'string' && prefix.length > 0
                ? `?prefix=${encodeURIComponent(prefix)}`
                : '';
            const response = await fetch(`/api/admin/clickhouse/stats${query}`, {
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch stats: ${response.statusText}`);
            }

            const result = await response.json();
            setStats(result.data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch ClickHouse stats');
        } finally {
            setLoading(false);
        }
    }, [prefix]);

    const fetchRows = useCallback(async (tableName: string, page: number = 1) => {
        try {
            setLoadingRows(true);
            const response = await fetch(
                `/api/admin/clickhouse/tables/${encodeURIComponent(tableName)}/rows?page=${page}&limit=10`,
                {
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            if (!response.ok) {
                throw new Error(`Failed to fetch rows: ${response.statusText}`);
            }

            const result = await response.json();
            setRows(result.data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch rows');
        } finally {
            setLoadingRows(false);
        }
    }, []);

    useEffect(() => {
        void fetchStats();
    }, [fetchStats]);

    /**
     * Open a table's row panel, or close it if it is the open one.
     *
     * Any expanded row inside the previous panel is dropped, because row
     * expansion is keyed by position within a page and that key means something
     * different in a different table.
     *
     * @param tableName - The table the operator clicked.
     */
    const toggleTable = (tableName: string) => {
        setExpandedRowKey(null);
        if (expandedTable === tableName) {
            setExpandedTable(null);
            setRows(null);
        } else {
            setExpandedTable(tableName);
            void fetchRows(tableName);
        }
    };

    /**
     * Unfold a row's full JSON, or fold it back up if it is already open.
     *
     * @param rowKey - Page-and-index key identifying the row.
     */
    const toggleRow = (rowKey: string) => {
        setExpandedRowKey((prev) => (prev === rowKey ? null : rowKey));
    };

    /**
     * Rank a column, or flip it if it is already the ranked one.
     *
     * Table expansion is keyed by name rather than position, so an open table
     * stays open across a re-sort and the operator does not lose the rows they
     * were reading.
     *
     * @param key - The column the operator clicked.
     */
    const toggleSort = useCallback((key: TableSortKey) => {
        setSort((previous) => {
            if (previous.key === key) {
                return { key, direction: previous.direction === 'asc' ? 'desc' : 'asc' };
            }

            const column = TABLE_COLUMNS.find((candidate) => candidate.key === key);
            return { key, direction: column?.initialDirection ?? 'desc' };
        });
    }, []);

    const sortedTables = useMemo(
        () => [...(stats?.tables ?? [])].sort((a, b) => compareTables(a, b, sort)),
        [stats?.tables, sort]
    );

    if (loading) {
        return <p className={styles.empty}>Loading ClickHouse statistics…</p>;
    }

    if (error) {
        return (
            <div className="alert alert--danger" role="alert">
                <span className={styles.error_inline}>
                    <AlertCircle size={14} aria-hidden="true" />
                    {error}
                </span>
            </div>
        );
    }

    if (!stats) {
        return <p className={styles.empty}>No ClickHouse statistics available.</p>;
    }

    // An embedded caller that stores nothing in ClickHouse should render
    // nothing at all — an empty ClickHouse panel reads as "data is missing"
    // rather than "this plugin has no ClickHouse tables".
    if (hideWhenEmpty && sortedTables.length === 0) {
        return null;
    }

    return (
        <div className={styles.browser}>
            {title !== undefined && <h3 className={styles.section_title}>{title}</h3>}
            <p className={styles.overview}>
                <code className={styles.db_name}>{stats.dbName}</code>
                <span className={styles.overview_meta}>
                    {stats.tables.length} {stats.tables.length === 1 ? 'table' : 'tables'} ·{' '}
                    {formatBytes(stats.totalSize)} total
                </span>
            </p>

            {sortedTables.length === 0 ? (
                <p className={styles.empty}>
                    {typeof prefix === 'string' && prefix.length > 0
                        ? `No tables found for ${prefix}`
                        : 'No tables found'}
                </p>
            ) : (
                <Table variant="compact">
                    <Thead>
                        <Tr>
                            <Th width="shrink" aria-label="Expand" />
                            {TABLE_COLUMNS.map((column) => {
                                const isSorted = sort.key === column.key;
                                return (
                                    <Th
                                        key={column.key}
                                        width={column.numeric ? 'shrink' : 'expand'}
                                        numeric={column.numeric}
                                        aria-sort={
                                            isSorted
                                                ? (sort.direction === 'asc' ? 'ascending' : 'descending')
                                                : 'none'
                                        }
                                    >
                                        <button
                                            type="button"
                                            className={styles.sort_button}
                                            onClick={() => toggleSort(column.key)}
                                        >
                                            {column.label}
                                            {isSorted
                                                ? (sort.direction === 'asc'
                                                    ? <ArrowUp size={14} aria-hidden="true" />
                                                    : <ArrowDown size={14} aria-hidden="true" />)
                                                : (
                                                    <ArrowUpDown
                                                        size={14}
                                                        aria-hidden="true"
                                                        className={styles.sort_icon_idle}
                                                    />
                                                )}
                                        </button>
                                    </Th>
                                );
                            })}
                        </Tr>
                    </Thead>
                    <Tbody>
                        {sortedTables.map((table) => {
                            const isTableOpen = expandedTable === table.name;
                            return (
                                <Fragment key={table.name}>
                                    <Tr
                                        isExpanded={isTableOpen}
                                        className={styles.table_row}
                                        onClick={() => toggleTable(table.name)}
                                    >
                                        <Td muted>
                                            {/* The row itself is clickable for pointer users; this button is
                                              * what makes the same toggle reachable by keyboard, so it stops
                                              * the click from also firing the row handler and undoing itself. */}
                                            <button
                                                type="button"
                                                className={styles.expand_button}
                                                aria-expanded={isTableOpen}
                                                aria-label={`${isTableOpen ? 'Collapse' : 'Expand'} ${table.name}`}
                                                onClick={(event) => {
                                                    event.stopPropagation();
                                                    toggleTable(table.name);
                                                }}
                                            >
                                                {isTableOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                            </button>
                                        </Td>
                                        <Td>
                                            <code className={styles.table_name}>{table.name}</code>
                                        </Td>
                                        <Td muted numeric>{table.rowCount.toLocaleString()}</Td>
                                        <Td muted numeric className={styles.size_cell}>{formatBytes(table.sizeBytes)}</Td>
                                        <Td muted className={styles.engine_cell}>{table.engine}</Td>
                                    </Tr>

                                    {isTableOpen && (
                                        <Tr className={styles.rows_row}>
                                            <Td colSpan={TABLE_COLUMNS.length + 1}>
                                                <div className={styles.rows_panel}>
                                                    {loadingRows ? (
                                                        <p className={styles.empty}>Loading rows…</p>
                                                    ) : rows ? (
                                                        <>
                                                            <div className={styles.rows_header}>
                                                                <span>
                                                                    Showing {rows.rows.length} of {rows.total.toLocaleString()} rows
                                                                </span>
                                                                <div className={styles.pagination}>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="xs"
                                                                        disabled={!rows.hasPrevPage}
                                                                        onClick={() => void fetchRows(table.name, rows.page - 1)}
                                                                    >
                                                                        Previous
                                                                    </Button>
                                                                    <span className={styles.page_info}>
                                                                        Page {rows.page} of {rows.totalPages}
                                                                    </span>
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="xs"
                                                                        disabled={!rows.hasNextPage}
                                                                        onClick={() => void fetchRows(table.name, rows.page + 1)}
                                                                    >
                                                                        Next
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                            <div className={styles.rows_list}>
                                                                {rows.rows.length === 0 ? (
                                                                    <p className={styles.empty}>Table is empty.</p>
                                                                ) : (
                                                                    <Table variant="compact">
                                                                        <Thead>
                                                                            <Tr>
                                                                                <Th width="shrink" aria-label="Expand" />
                                                                                <Th>Row</Th>
                                                                                <Th>Preview</Th>
                                                                                <Th width="shrink" aria-label="Actions" />
                                                                            </Tr>
                                                                        </Thead>
                                                                        <Tbody>
                                                                            {rows.rows.map((row, index) => {
                                                                                const rowKey = `${rows.page}_${index}`;
                                                                                const isOpen = expandedRowKey === rowKey;
                                                                                const rowJson = JSON.stringify(row, null, 2);
                                                                                const preview = buildPreview(row);
                                                                                return (
                                                                                    <Fragment key={rowKey}>
                                                                                        <Tr
                                                                                            isExpanded={isOpen}
                                                                                            onClick={() => toggleRow(rowKey)}
                                                                                            className={styles.row}
                                                                                        >
                                                                                            <Td muted>
                                                                                                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                                                                            </Td>
                                                                                            <Td muted>
                                                                                                <code className={styles.row_index}>
                                                                                                    {(rows.page - 1) * rows.limit + index + 1}
                                                                                                </code>
                                                                                            </Td>
                                                                                            <Td>
                                                                                                <code className={styles.row_preview}>{preview}</code>
                                                                                            </Td>
                                                                                            <Td>
                                                                                                <div onClick={(e) => e.stopPropagation()}>
                                                                                                    <CopyButton
                                                                                                        value={rowJson}
                                                                                                        aria-label="Copy row JSON"
                                                                                                    />
                                                                                                </div>
                                                                                            </Td>
                                                                                        </Tr>
                                                                                        {isOpen && (
                                                                                            <Tr className={styles.row_detail}>
                                                                                                <Td colSpan={4}>
                                                                                                    <pre className={styles.row_json}>{rowJson}</pre>
                                                                                                </Td>
                                                                                            </Tr>
                                                                                        )}
                                                                                    </Fragment>
                                                                                );
                                                                            })}
                                                                        </Tbody>
                                                                    </Table>
                                                                )}
                                                            </div>
                                                        </>
                                                    ) : (
                                                        <p className={styles.empty}>No rows loaded.</p>
                                                    )}
                                                </div>
                                            </Td>
                                        </Tr>
                                    )}
                                </Fragment>
                            );
                        })}
                    </Tbody>
                </Table>
            )}
        </div>
    );
}

/**
 * Build a one-line key=value preview of the row's first few columns so the
 * collapsed table row shows useful identifying data without overflowing.
 * The full row is available in the expanded JSON view.
 */
function buildPreview(row: Record<string, unknown>): string {
    const entries = Object.entries(row).slice(0, 3);
    if (entries.length === 0) return '(empty row)';
    return entries
        .map(([key, value]) => `${key}=${formatPreviewValue(value)}`)
        .join('  ');
}

function formatPreviewValue(value: unknown): string {
    if (value === null || value === undefined) return '∅';
    if (typeof value === 'string') {
        return value.length > 32 ? `"${value.slice(0, 29)}…"` : `"${value}"`;
    }
    if (typeof value === 'object') return '{…}';
    return String(value);
}
