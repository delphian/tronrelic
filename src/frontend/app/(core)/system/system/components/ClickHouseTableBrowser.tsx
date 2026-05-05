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
 */

import { useState, useEffect, useCallback, Fragment } from 'react';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { CopyButton } from '../../../../../components/ui/CopyButton';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { formatBytes } from '../../../../../lib/format';
import { ChevronDown, ChevronRight, FileText, AlertCircle } from 'lucide-react';
import styles from './ClickHouseTableBrowser.module.scss';

interface ITableStat {
    name: string;
    rowCount: number;
    sizeBytes: number;
    engine: string;
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

interface ClickHouseTableBrowserProps {
    token: string;
}

export function ClickHouseTableBrowser({ token }: ClickHouseTableBrowserProps) {
    const [stats, setStats] = useState<IClickHouseStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [expandedTable, setExpandedTable] = useState<string | null>(null);
    const [rows, setRows] = useState<IPaginatedRows | null>(null);
    const [loadingRows, setLoadingRows] = useState(false);
    const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
    const runtimeConfig = getRuntimeConfig();

    const fetchStats = useCallback(async () => {
        try {
            setLoading(true);
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/clickhouse/stats`, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                }
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
    }, [token, runtimeConfig.apiUrl]);

    const fetchRows = useCallback(async (tableName: string, page: number = 1) => {
        try {
            setLoadingRows(true);
            const response = await fetch(
                `${runtimeConfig.apiUrl}/admin/clickhouse/tables/${encodeURIComponent(tableName)}/rows?page=${page}&limit=10`,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Admin-Token': token
                    }
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
    }, [token, runtimeConfig.apiUrl]);

    useEffect(() => {
        void fetchStats();
    }, [fetchStats]);

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

    const toggleRow = (rowKey: string) => {
        setExpandedRowKey((prev) => (prev === rowKey ? null : rowKey));
    };

    const sortedTables = stats?.tables ?? [];

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

    return (
        <div className={styles.browser}>
            <p className={styles.overview}>
                <code className={styles.db_name}>{stats.dbName}</code>
                <span className={styles.overview_meta}>
                    {stats.tables.length} {stats.tables.length === 1 ? 'table' : 'tables'} ·{' '}
                    {formatBytes(stats.totalSize)} total
                </span>
            </p>

            <div className={styles.tables}>
                {sortedTables.map((table) => (
                    <div key={table.name} className={styles.table_item}>
                        <button
                            type="button"
                            className={styles.table_header}
                            onClick={() => toggleTable(table.name)}
                            aria-expanded={expandedTable === table.name}
                        >
                            {expandedTable === table.name ? (
                                <ChevronDown size={14} />
                            ) : (
                                <ChevronRight size={14} />
                            )}
                            <FileText size={14} />
                            <span className={styles.table_name}>{table.name}</span>
                            <div className={styles.table_stats}>
                                <Badge tone="neutral">{table.rowCount.toLocaleString()} rows</Badge>
                                <Badge tone="neutral">{formatBytes(table.sizeBytes)}</Badge>
                                <Badge tone="neutral">{table.engine}</Badge>
                            </div>
                        </button>

                        {expandedTable === table.name && (
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
                                                                                    ariaLabel="Copy row JSON"
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
                        )}
                    </div>
                ))}
            </div>
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
