'use client';

/**
 * ClickHouse table browser component for the system console.
 *
 * Mirrors CollectionBrowser (the MongoDB equivalent) so admins get the
 * same expand-then-paginate experience for analytical tables, and shares its
 * panel, inventory table, and page bar so the two look the same when they sit
 * one above the other. Differences from the Mongo browser: rows have no stable
 * `_id`, so expansion uses the row's position in the page; deletion is not
 * exposed because `ALTER TABLE ... DELETE` is async and dangerous in
 * ClickHouse — viewing is the only operation needed for ops debugging.
 *
 * The inventory is a real table with sortable columns for the same reason the
 * Mongo browser is: row count and stored size are quantities an operator
 * compares across tables — which one is eating disk, which one explains a slow
 * query — and a column of right-aligned figures answers that by scanning.
 *
 * Unscoped, this is the universal browser and lists every database except
 * ClickHouse's own, so a table outside the application database — the `tron`
 * chain data, for one — is named with its database (`tron.block`) while the
 * application's own tables keep their bare names. Scoped by plugin or by table
 * names, the server keeps the list inside the application database. Scoped by
 * plugin, every table starts with `plugin_<id>_`, so the rows leave that
 * prefix out and the header states it once.
 *
 * `collapsible` puts the inventory behind a closed disclosure, as on the Mongo
 * browser, for a page where the unscoped listing would push everything below
 * it off screen.
 */

import { useState, useEffect, useCallback, useMemo, Fragment, type ReactNode } from 'react';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { CopyButton } from '../../../../components/ui/CopyButton';
import type { IClickHouseTableBrowserProps } from '@/types';
// Imported from its own module rather than the `@/types` barrel. This is a
// 'use client' component, so a value import is bundled for the browser, and
// the barrel value-re-exports backend helpers — the auth predicates, the URL
// guards, definePlugin — that would be shipped to the client along with it.
// A type-only import from the barrel is erased and does not have this cost.
import { pluginPrefix } from '@/types/plugin/pluginPrefix';
import { formatBytes } from '../../../../lib/format';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { BrowserPanel, type IBrowserSummary } from '../BrowserPanel';
import { BrowserPager } from '../BrowserPager';
import { InventoryTable, InventoryRow } from '../InventoryTable';
import { useInventorySort } from '../../hooks/useInventorySort';
import { stripNamePrefix } from '../../lib/stripNamePrefix';
import { formatCount } from '../../lib/formatCount';
import type { IInventoryColumn } from '../../types/IInventoryColumn';
import type { IInventorySort } from '../../types/IInventorySort';
import styles from './ClickHouseTableBrowser.module.scss';

interface ITableStat {
    database: string;
    name: string;
    rowCount: number;
    sizeBytes: number;
    engine: string;
}

/**
 * The identity of a table across databases.
 *
 * Two databases may each hold a table of the same name, so the bare name
 * cannot key expansion state or React list items once the listing spans
 * databases. A dot cannot appear in an unquoted database name, so the key is
 * unambiguous.
 */
function tableKey(table: ITableStat): string {
    return `${table.database}.${table.name}`;
}

/**
 * The full name an operator reads for a table, before any scope prefix is
 * removed for display.
 *
 * A table in the application database keeps its bare name, so the list looks
 * as it always has for the tables most operators come here for; a table in any
 * other database carries its database in front, so `tron.block` cannot be
 * mistaken for an application table.
 */
function tableLabel(table: ITableStat, applicationDatabase: string): string {
    return table.database === applicationDatabase ? table.name : tableKey(table);
}

/** A column the table inventory can be ranked by. */
type TableSortKey = 'name' | 'rowCount' | 'sizeBytes' | 'engine';

/**
 * The sortable columns of the table inventory.
 *
 * The numeric columns open descending because the question an operator brings
 * here is nearly always "what is biggest". The text columns open ascending,
 * which is plain alphabetical order.
 */
const TABLE_COLUMNS: ReadonlyArray<IInventoryColumn<TableSortKey>> = [
    { key: 'name', label: 'Table', numeric: false, initialDirection: 'asc' },
    { key: 'rowCount', label: 'Rows', numeric: true, initialDirection: 'desc' },
    { key: 'sizeBytes', label: 'Size', numeric: true, initialDirection: 'desc' },
    { key: 'engine', label: 'Engine', numeric: false, initialDirection: 'asc' }
];

/** Where the inventory rests before the operator sorts it: alphabetical by name. */
const DEFAULT_SORT: IInventorySort<TableSortKey> = { key: 'name', direction: 'asc' };

/**
 * Order two tables by the active column.
 *
 * Names and engines compare with `localeCompare` so the alphabetical view
 * matches what a reader expects of mixed-case, prefixed identifiers; every
 * other column is a plain number. Names compare with their database in front,
 * so each database's tables stay together in the alphabetical view. Direction
 * is applied by negating the comparison, so one comparator serves both
 * directions instead of two near-identical ones.
 *
 * @param a - Left-hand table.
 * @param b - Right-hand table.
 * @param sort - The active column and direction.
 * @returns Negative, zero, or positive per the `Array.prototype.sort` contract.
 */
function compareTables(a: ITableStat, b: ITableStat, sort: IInventorySort<TableSortKey>): number {
    let ordering: number;
    if (sort.key === 'name') {
        ordering = tableKey(a).localeCompare(tableKey(b));
    } else if (sort.key === 'engine') {
        ordering = a.engine.localeCompare(b.engine);
    } else {
        ordering = a[sort.key] - b[sort.key];
    }

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
 * @param pluginId - Scope to one plugin's tables by its `manifest.id`. The
 * prefix is derived here rather than accepted from the caller, because a
 * prefix written out by hand drifts when an identifier changes and the
 * mistake does not announce itself — the filter matches nothing and the
 * browser renders empty instead of reporting an error.
 * @param tables - Scope to exactly these table names. A core module's tables
 * share no naming prefix, so a module names its own; honoured when `pluginId`
 * is absent.
 * @param prefix - Deprecated literal prefix, honoured only when `pluginId` and
 * `tables` are both absent so existing callers keep working while they migrate.
 * @param title - Title of the browser's panel; "Tables" when omitted. In the
 * collapsible form it doubles as the control that opens the browser.
 * @param hideWhenEmpty - Render nothing when no table matches, rather than an
 * empty panel that reads as missing data.
 * @param collapsible - Whether to start closed behind a disclosure heading.
 */
export function ClickHouseTableBrowser(props: IClickHouseTableBrowserProps) {
    const { pluginId, tables, prefix, title, hideWhenEmpty = false, collapsible = false } = props;

    /**
     * Whether the caller asked for plugin scoping at all, as opposed to what
     * they asked to scope to.
     *
     * The prop is optional, so its value cannot tell these apart: omitting it
     * and passing `pluginId={someId}` where `someId` is undefined — a renamed
     * barrel export, a field spread from a half-populated object — both arrive
     * as `undefined`. Testing for the key instead means an undefined value
     * reaches `pluginPrefix()` and is reported, rather than falling
     * through to the unscoped view that lists the whole deployment.
     */
    const scopesByPluginId = 'pluginId' in props;
    /**
     * Whether the caller asked for exact-name scoping, tested by key for the
     * same reason as `pluginId`: a `tables` prop that arrived undefined or
     * empty must be reported, not read as a request for the unscoped view.
     */
    const scopesByTables = 'tables' in props;
    /**
     * The requested table names joined into one string, used as the memo
     * dependency instead of the array itself. A caller passing an array
     * literal hands over a new array on every render, and depending on that
     * identity would rebuild the scope and refetch the stats each time.
     * Table names cannot contain a newline, so it is a safe separator.
     */
    const tablesKey = Array.isArray(tables) ? tables.join('\n') : '';
    /**
     * The prefix used for filtering, for the empty-state message, and for
     * shortening the listed names, plus the reason it could not be derived when
     * the caller supplied an unusable id.
     *
     * A `pluginId` the caller supplied but that is blank or undefined must not
     * fall back to `prefix`. Falling back sends no `?prefix=` at all, and the
     * stats endpoint reads an absent prefix as "every table", so a plugin
     * panel whose id arrived empty would list core's tables instead of its
     * own. Only an omitted `pluginId` uses `prefix`, which is what the
     * unscoped core system console relies on. `pluginId` still wins when both
     * are supplied, so a caller mid-migration gets the derived value.
     *
     * The failure travels as a value rather than as a thrown error, because
     * `pluginPrefix()` throws and throwing here would take down the whole
     * admin page instead of this one panel.
     */
    const scope = useMemo<{ prefix?: string; tables?: string[]; error?: string }>(() => {
        let result: { prefix?: string; tables?: string[]; error?: string };
        if (scopesByPluginId) {
            try {
                // Typed optional, but the key is present, so an undefined value is
                // a caller mistake rather than a request for the unscoped view.
                // pluginPrefix() rejects it, which is what should happen.
                result = { prefix: pluginPrefix(pluginId as string) };
            } catch (err) {
                result = { error: err instanceof Error ? err.message : 'Invalid plugin id' };
            }
        } else if (scopesByTables) {
            const names = tablesKey.split('\n').filter((name) => name.length > 0);
            result = names.length > 0
                ? { tables: names }
                : { error: 'ClickHouseTableBrowser requires at least one table name in tables' };
        } else {
            result = { prefix };
        }
        return result;
    }, [scopesByPluginId, pluginId, scopesByTables, tablesKey, prefix]);

    // Disclosure state for the collapsible form. Declared unconditionally, and
    // read through `isCollapsed` below, so the always-expanded form runs the
    // same hooks in the same order.
    const [collapsed, setCollapsed] = useState(true);
    const isCollapsed = collapsible && collapsed;

    const [stats, setStats] = useState<IClickHouseStats | null>(null);
    const { sort, toggleSort } = useInventorySort(TABLE_COLUMNS, DEFAULT_SORT);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedTable, setExpandedTable] = useState<string | null>(null);
    const [rows, setRows] = useState<IPaginatedRows | null>(null);
    const [loadingRows, setLoadingRows] = useState(false);
    const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

    /**
     * Load table statistics for the browser's scope.
     *
     * The scope travels as query parameters so the server filters in SQL, and
     * an embedded caller never receives the wider table list.
     */
    const fetchStats = useCallback(async () => {
        // An unusable plugin id stops the request outright. Querying without a
        // prefix would return the whole deployment's inventory, which is the
        // opposite of what a scoped caller asked for.
        if (scope.error) {
            setError(scope.error);
            setStats(null);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            let query = '';
            if (scope.tables) {
                query = `?${scope.tables.map((name) => `tables=${encodeURIComponent(name)}`).join('&')}`;
            } else if (typeof scope.prefix === 'string' && scope.prefix.length > 0) {
                query = `?prefix=${encodeURIComponent(scope.prefix)}`;
            }
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
    }, [scope]);

    /**
     * Load one page of a table's rows.
     *
     * The table's database travels with the request because the universal
     * listing spans databases, and a bare name would be read against the
     * application database only.
     *
     * @param table - The table whose rows to load.
     * @param page - The page to load, counted from 1.
     */
    const fetchRows = useCallback(async (table: ITableStat, page: number = 1) => {
        try {
            setLoadingRows(true);
            const response = await fetch(
                `/api/admin/clickhouse/tables/${encodeURIComponent(table.name)}/rows` +
                    `?page=${page}&limit=10&database=${encodeURIComponent(table.database)}`,
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

    // A closed browser does not fetch, as on the Mongo browser, unless
    // `hideWhenEmpty` is set. That option has to know whether any table
    // matches before it can decide to render nothing, and the request is one
    // read of `system.tables`, so it runs while closed rather than leaving a
    // disclosure on screen that vanishes when the operator opens it.
    const shouldFetchStats = !isCollapsed || hideWhenEmpty;

    /**
     * Fetch the statistics once the browser needs them, and again when its
     * scope changes. Opening a browser that already fetched while closed does
     * not refetch, because `shouldFetchStats` stays true across the change.
     */
    useEffect(() => {
        if (shouldFetchStats) {
            void fetchStats();
        }
    }, [shouldFetchStats, fetchStats]);

    /**
     * Open a table's row panel, or close it if it is the open one.
     *
     * Any expanded row inside the previous panel is dropped, because row
     * expansion is keyed by position within a page and that key means something
     * different in a different table.
     *
     * @param table - The table the operator clicked.
     */
    const toggleTable = (table: ITableStat) => {
        const key = tableKey(table);
        setExpandedRowKey(null);
        if (expandedTable === key) {
            setExpandedTable(null);
            setRows(null);
        } else {
            setExpandedTable(key);
            void fetchRows(table);
        }
    };

    /** Unfold a row's full JSON (keyed by page and index), or fold it back up if it is already open. */
    const toggleRow = (rowKey: string) => {
        setExpandedRowKey((prev) => (prev === rowKey ? null : rowKey));
    };

    /** The inventory in the order the active sort asks for, copied so state is never sorted in place. */
    const sortedTables = useMemo(
        () => [...(stats?.tables ?? [])].sort((a, b) => compareTables(a, b, sort)),
        [stats?.tables, sort]
    );

    /**
     * Every database the listing covers, for the header's summary line. A
     * scoped listing covers only the application database; the universal one
     * names each database it found, so an operator can see the chain data is
     * there without scrolling for it.
     */
    const databaseNames = useMemo(() => {
        const names = new Set((stats?.tables ?? []).map((table) => table.database));
        if (stats?.dbName) {
            names.add(stats.dbName);
        }
        return [...names].sort((a, b) => a.localeCompare(b));
    }, [stats?.tables, stats?.dbName]);

    // The header's summary line. Kept once the statistics have loaded, so a
    // browser closed again after being opened still says what it holds.
    const summary: IBrowserSummary | null = stats === null ? null : {
        databases: databaseNames,
        prefix: scope.prefix,
        count: stats.tables.length,
        singular: 'table',
        plural: 'tables',
        totalSize: stats.totalSize
    };

    /**
     * Build the row panel shown beneath an open table.
     *
     * Only the open table calls this, so `rows` always belongs to it.
     *
     * @param table - The open table.
     * @returns The page bar and the page's rows, or the loading or empty
     * message in their place.
     */
    const renderRows = (table: ITableStat): ReactNode => (
        <div className={styles.rows_panel}>
            {loadingRows && <p className={styles.message}>Loading rows…</p>}
            {!loadingRows && rows === null && <p className={styles.message}>No rows loaded.</p>}
            {!loadingRows && rows !== null && (
                <>
                    <BrowserPager
                        summary={formatCount(rows.total, 'row', 'rows')}
                        page={rows.page}
                        totalPages={Math.max(1, rows.totalPages)}
                        canFirst={rows.page > 1}
                        canPrevious={rows.hasPrevPage}
                        canNext={rows.hasNextPage}
                        canLast={rows.hasNextPage}
                        onFirst={() => void fetchRows(table, 1)}
                        onPrevious={() => void fetchRows(table, rows.page - 1)}
                        onNext={() => void fetchRows(table, rows.page + 1)}
                        onLast={() => void fetchRows(table, rows.totalPages)}
                    />
                    {rows.rows.length === 0 ? (
                        <p className={styles.message}>Table is empty.</p>
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
                </>
            )}
        </div>
    );

    // What the panel shows beneath its header. Every state keeps the header,
    // because in the collapsible form the heading is the disclosure control:
    // dropping it with a failed request would leave an error on screen the
    // operator could no longer close.
    let body: ReactNode = null;
    if (isCollapsed) {
        body = null;
    } else if (loading) {
        body = <p className={styles.message}>Loading ClickHouse statistics…</p>;
    } else if (error) {
        body = (
            <div className="alert alert--danger" role="alert">
                <span className={styles.error_inline}>
                    <AlertCircle size={14} aria-hidden="true" />
                    {error}
                </span>
            </div>
        );
    } else if (!stats) {
        body = <p className={styles.message}>No ClickHouse statistics available.</p>;
    } else if (sortedTables.length === 0) {
        let emptyMessage = 'No tables found';
        if (scope.tables) {
            emptyMessage = `No tables found for ${scope.tables.join(', ')}`;
        } else if (typeof scope.prefix === 'string' && scope.prefix.length > 0) {
            emptyMessage = `No tables found for ${scope.prefix}`;
        }
        body = <p className={styles.message}>{emptyMessage}</p>;
    } else {
        const applicationDatabase = stats.dbName;
        body = (
            <InventoryTable
                columns={TABLE_COLUMNS}
                sort={sort}
                onSort={toggleSort}
                rowCount={sortedTables.length}
            >
                {sortedTables.map((table) => {
                    const key = tableKey(table);
                    const fullLabel = tableLabel(table, applicationDatabase);
                    const isTableOpen = expandedTable === key;
                    return (
                        <InventoryRow
                            key={key}
                            name={fullLabel}
                            label={stripNamePrefix(fullLabel, scope.prefix)}
                            expanded={isTableOpen}
                            onToggle={() => toggleTable(table)}
                            figures={[
                                {
                                    key: 'rowCount',
                                    value: table.rowCount.toLocaleString(),
                                    summary: formatCount(table.rowCount, 'row', 'rows'),
                                    numeric: true
                                },
                                {
                                    key: 'sizeBytes',
                                    value: formatBytes(table.sizeBytes),
                                    summary: formatBytes(table.sizeBytes),
                                    numeric: true
                                },
                                {
                                    key: 'engine',
                                    value: table.engine,
                                    summary: table.engine,
                                    className: styles.engine_cell
                                }
                            ]}
                        >
                            {isTableOpen ? renderRows(table) : null}
                        </InventoryRow>
                    );
                })}
            </InventoryTable>
        );
    }

    // An embedded caller that stores nothing in ClickHouse should render
    // nothing at all — an empty ClickHouse panel reads as "data is missing"
    // rather than "this plugin has no ClickHouse tables".
    //
    // An error overrides this. hideWhenEmpty means "this plugin stores nothing
    // in ClickHouse, so say nothing" — it does not mean "stay quiet when the
    // caller misconfigured the scope". A bad pluginId that rendered nothing
    // would look identical to a plugin with no tables, which is the silent
    // failure this component's pluginId prop exists to remove, so it is
    // reported even here.
    const hidden = hideWhenEmpty && !loading && !error && stats !== null && sortedTables.length === 0;

    return hidden ? null : (
        <BrowserPanel
            title={title ?? 'Tables'}
            collapsible={collapsible}
            collapsed={collapsed}
            onToggle={() => setCollapsed(previous => !previous)}
            summary={summary}
        >
            {body}
        </BrowserPanel>
    );
}

/**
 * Build a one-line key=value preview of the row's first few columns so the
 * collapsed table row shows useful identifying data without overflowing.
 * The full row is available in the expanded JSON view.
 */
function buildPreview(row: Record<string, unknown>): string {
    const entries = Object.entries(row).slice(0, 3);
    return entries.length === 0
        ? '(empty row)'
        : entries.map(([key, value]) => `${key}=${formatPreviewValue(value)}`).join('  ');
}

/**
 * Shorten one column value for the row preview, so a long string or a nested
 * object cannot stretch the preview past one line. The expanded JSON view
 * shows the value in full.
 */
function formatPreviewValue(value: unknown): string {
    let preview: string;
    if (value === null || value === undefined) {
        preview = '∅';
    } else if (typeof value === 'string') {
        preview = value.length > 32 ? `"${value.slice(0, 29)}…"` : `"${value}"`;
    } else if (typeof value === 'object') {
        preview = '{…}';
    } else {
        preview = String(value);
    }
    return preview;
}
