'use client';

import { Fragment, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import {
    AlertCircle,
    CheckCircle,
    Play,
    RefreshCw,
    XCircle
} from 'lucide-react';
import { Stack } from '../../../../../../../components/layout';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Button } from '../../../../../../../components/ui/Button';
import { Badge } from '../../../../../../../components/ui/Badge';
import { Pagination } from '../../../../../../../components/ui/Pagination';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../../components/ui/Table';
import { Select } from '../../../../../../../components/ui/Select';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import { formatBytes } from '../../../../../../../lib/format';
import { StatStrip } from './StatStrip';
import { formatMs } from './pipeline/pipeline-format';
import { CollectionBrowser } from '../../../../../../../modules/database';
import styles from './MongoSection.module.scss';

/** MongoDB health as the database probe reports it. */
interface IDatabaseStatus {
    connected: boolean;
    responseTime: number | null;
    poolSize: number;
    availableConnections: number;
    databaseSize: number | null;
    collectionCount: number;
    recentErrors: string[];
}

/** One migration found on disk that has not run. */
interface IMigrationMetadata {
    id: string;
    description: string;
    source: string;
    filePath: string;
    timestamp: string;
    dependencies: string[];
    checksum?: string;
}

/** One recorded run of a migration. */
interface IMigrationExecution {
    migrationId: string;
    status: 'completed' | 'failed';
    source: string;
    executedAt: string;
    executionDuration: number;
    error?: string;
    errorStack?: string;
}

/** The status endpoint's answer: the pending queue and the totals. */
interface IMigrationStatus {
    pending: IMigrationMetadata[];
    completed: IMigrationExecution[];
    isRunning: boolean;
    totalPending: number;
    totalCompleted: number;
}

/** The history endpoint's answer. */
interface IMigrationHistory {
    migrations: IMigrationExecution[];
    total: number;
}

/** Status filter choices for the history table. */
type HistoryStatusFilter = 'all' | 'completed' | 'failed';

/**
 * Runs shown per history page.
 *
 * The backend returns the whole history in one response, because it is a
 * registry of every migration the deployment has run rather than an unbounded
 * log, so the page is cut in the browser. Showing all of it put fifty-odd rows
 * on the tab, about ten thousand pixels on a phone.
 */
const HISTORY_PAGE_SIZE = 10;

/** Columns in a history row, which an error row spans. */
const HISTORY_COLUMNS = 4;

/**
 * Let a qualified migration id wrap after its separators.
 *
 * An id such as `module:account-history:006_add_withdrawable_reward_to_snapshots`
 * is one unbroken word, so on a phone it broke at whichever letter reached the
 * edge. A break opportunity after each colon and underscore makes it wrap
 * between its parts instead.
 *
 * @param id - The migration id.
 * @returns The id with a `<wbr>` after each colon and underscore.
 */
function breakableId(id: string): ReactNode {
    const parts = id.split(/(?<=[:_])/);
    return parts.map((part, index) => (
        <Fragment key={index}>
            {part}
            {index < parts.length - 1 && <wbr />}
        </Fragment>
    ));
}

/**
 * MongoDB administration body — health, the collection browser, and migrations.
 *
 * Each concern stands in its own panel rather than sharing one: they are
 * independent surfaces an operator reads separately. Order follows how the tab
 * is used — health first as the at-a-glance condition, the browser next as the
 * reason to open the tab, and migrations last because they are consulted
 * during a deploy rather than during routine inspection.
 *
 * Migrations live on this tab because the `migrations` audit log is stored in
 * MongoDB; the executor still dispatches ClickHouse-targeted migrations
 * to the ClickHouse engine, but the operator-facing record of what ran
 * and when belongs to Mongo. ClickHouse health and the table browser
 * are a separate tab (see ClickHouseSection).
 *
 * @returns The MongoDB tab body as sibling panels.
 */
export function MongoSection() {
    return (
        <Stack gap="lg">
            <MongoHealth />
            {/* The browser draws its own panel, so it sits beside the other panels
              * rather than inside one. It starts collapsed: this view is unscoped,
              * so it lists every collection in the deployment, and expanded it
              * would bury the migration log under a hundred rows. Closed, it also
              * holds back the statistics request, one collStats per collection. */}
            <CollectionBrowser collapsible title="Collection Browser" />
            <Migrations />
        </Stack>
    );
}

/**
 * MongoDB connection health, polled every ten seconds.
 *
 * @returns The health panel.
 */
function MongoHealth() {
    const [database, setDatabase] = useState<IDatabaseStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    /** Read the database probe, keeping the last reading's absence explicit on failure. */
    const fetchData = useCallback(async () => {
        try {
            const response = await fetch(`/api/admin/system/health/database`);

            if (response.ok) {
                const data = await response.json();
                setDatabase(data.status);
            } else {
                setDatabase(null);
                throw new Error(`Health endpoint unavailable (${response.status})`);
            }
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch MongoDB health');
        }
    }, []);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    return (
        <Panel title="Health">
            {error && (
                <p className={styles.error_inline} role="alert">
                    <AlertCircle size={14} aria-hidden="true" />
                    {error}
                </p>
            )}
            {database && (
                <StatStrip
                    items={[
                        {
                            label: 'Status',
                            value: database.connected ? 'Connected' : 'Disconnected',
                            tone: database.connected ? 'success' : 'danger'
                        },
                        ...(database.responseTime !== null
                            ? [{ label: 'Response', value: `${database.responseTime}ms` }]
                            : []),
                        { label: 'Collections', value: database.collectionCount.toLocaleString() },
                        ...(database.databaseSize !== null
                            ? [{ label: 'Size', value: formatBytes(database.databaseSize) }]
                            : [])
                    ]}
                />
            )}
        </Panel>
    );
}

/**
 * Migration status, pending queue, and execution history, as two panels: the
 * pending queue with the controls that run it, then the history of runs.
 *
 * @returns The two migration panels.
 */
function Migrations() {
    const [status, setStatus] = useState<IMigrationStatus | null>(null);
    const [history, setHistory] = useState<IMigrationHistory | null>(null);
    const [executing, setExecuting] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>('all');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [page, setPage] = useState(1);
    const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    /** Load the pending queue and the running flag. */
    const fetchStatus = useCallback(async () => {
        try {
            const response = await fetch(`/api/admin/migrations/status`, {
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error(`Failed to fetch status: ${response.statusText}`);
            const data: IMigrationStatus = await response.json();
            setStatus(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch migration status');
        }
    }, []);

    /** Load the run history for the selected status. */
    const fetchHistory = useCallback(async () => {
        try {
            const params = new URLSearchParams({ limit: '100', status: statusFilter });
            const response = await fetch(`/api/admin/migrations/history?${params}`, {
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error(`Failed to fetch history: ${response.statusText}`);
            const data: IMigrationHistory = await response.json();
            setHistory(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch migration history');
        }
    }, [statusFilter]);

    /**
     * Run one pending migration, or every pending migration when no id is
     * given, then reload the queue and the history so both show the result.
     *
     * @param migrationId - The migration to run; omit to run every pending one.
     */
    const executeMigration = async (migrationId?: string) => {
        if (executing) return;
        setExecuting(true);
        setError(null);
        try {
            const response = await fetch(`/api/admin/migrations/execute`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(migrationId ? { migrationId } : {})
            });
            let data: any = null;
            try {
                data = await response.json();
            } catch {
                data = null;
            }
            if (response.status === 409) {
                setError(
                    data?.failed?.error
                        ?? data?.error
                        ?? data?.message
                        ?? 'Migration is already running. Please wait for it to complete.'
                );
                return;
            }
            if (!response.ok) {
                throw new Error(
                    data?.failed?.error
                        ?? data?.error
                        ?? data?.message
                        ?? `Failed to execute migration: ${response.statusText}`
                );
            }
            if (data?.success) {
                await Promise.all([fetchStatus(), fetchHistory()]);
            } else if (data?.failed) {
                setError(`Migration failed: ${data.failed.error}`);
                await Promise.all([fetchStatus(), fetchHistory()]);
            } else {
                throw new Error('Unexpected response from migrations/execute');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to execute migration');
        } finally {
            setExecuting(false);
        }
    };

    /**
     * Open or close one failed run's error under its row.
     *
     * @param runKey - The run's key, its migration id and start time, since a
     *   migration that failed and then succeeded has two runs.
     */
    const toggleErrorExpansion = (runKey: string) => {
        setExpandedErrors((prev) => {
            const next = new Set(prev);
            if (next.has(runKey)) next.delete(runKey);
            else next.add(runKey);
            return next;
        });
    };

    useEffect(() => {
        void fetchStatus();
    }, [fetchStatus]);

    useEffect(() => {
        void fetchHistory();
    }, [fetchHistory]);

    useEffect(() => {
        if (!autoRefresh) return;
        const interval = setInterval(() => void fetchStatus(), 5000);
        return () => clearInterval(interval);
    }, [autoRefresh, fetchStatus]);

    const uniqueSources = useMemo(
        () => (history ? Array.from(new Set(history.migrations.map((m) => m.source))).sort() : []),
        [history]
    );

    const filteredHistory = useMemo(
        () =>
            history
                ? sourceFilter === 'all'
                    ? history.migrations
                    : history.migrations.filter((m) => m.source === sourceFilter)
                : [],
        [history, sourceFilter]
    );

    // A filter change can leave fewer pages than the page being shown, so the
    // page is clamped rather than showing an empty table.
    const pageCount = Math.max(1, Math.ceil(filteredHistory.length / HISTORY_PAGE_SIZE));
    const currentPage = Math.min(page, pageCount);
    const pageRows = filteredHistory.slice((currentPage - 1) * HISTORY_PAGE_SIZE, currentPage * HISTORY_PAGE_SIZE);

    const groupedPending = useMemo(
        () =>
            status?.pending.reduce((acc, migration) => {
                if (!acc[migration.source]) acc[migration.source] = [];
                acc[migration.source].push(migration);
                return acc;
            }, {} as Record<string, IMigrationMetadata[]>) || {},
        [status?.pending]
    );

    /**
     * Render one pending migration with its own Execute button.
     *
     * @param migration - The pending migration.
     * @returns The list item.
     */
    const renderPending = (migration: IMigrationMetadata) => (
        <li key={migration.id} className={styles.migration_row}>
            <div className={styles.migration_info}>
                <code className={styles.migration_id}>{breakableId(migration.id)}</code>
                <span className={styles.migration_description}>{migration.description}</span>
                {migration.dependencies.length > 0 && (
                    <span className={styles.migration_deps}>
                        Depends on{' '}
                        {migration.dependencies.map((dep, index) => (
                            <Fragment key={dep}>
                                {index > 0 && ', '}
                                <code>{breakableId(dep)}</code>
                            </Fragment>
                        ))}
                    </span>
                )}
            </div>
            <Button
                variant="ghost"
                size="xs"
                onClick={() => void executeMigration(migration.id)}
                disabled={executing || status?.isRunning}
                icon={<Play size={12} />}
            >
                Execute
            </Button>
        </li>
    );

    return (
        <>
            <Panel
                title="Migrations"
                meta={status && (
                    <>
                        {status.totalPending.toLocaleString()} pending · {status.totalCompleted.toLocaleString()} completed ·{' '}
                        <Badge tone={status.isRunning ? 'warning' : 'success'} size="xs">
                            {status.isRunning ? 'Running' : 'Ready'}
                        </Badge>
                    </>
                )}
                actions={(
                    <>
                        <Button
                            variant="ghost"
                            onClick={() => setAutoRefresh((prev) => !prev)}
                            icon={<RefreshCw size={14} />}
                            aria-pressed={autoRefresh}
                        >
                            {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
                        </Button>
                        <Button
                            variant="primary"
                            onClick={() => void executeMigration()}
                            disabled={executing || status?.isRunning || !status?.totalPending}
                            loading={executing}
                            icon={<Play size={14} />}
                        >
                            Execute pending
                        </Button>
                    </>
                )}
            >
                {error && (
                    <p className={styles.error_inline} role="alert">
                        <AlertCircle size={14} aria-hidden="true" />
                        {error}
                    </p>
                )}

                {status && status.totalPending === 0 ? (
                    <p className={styles.empty}>
                        <CheckCircle size={14} aria-hidden="true" />
                        No pending migrations
                    </p>
                ) : (
                    // A source with one pending migration gets no heading of its
                    // own: its id already names the source.
                    <ul className={styles.migration_list}>
                        {Object.entries(groupedPending).map(([source, migrations]) => (
                            migrations.length === 1 ? renderPending(migrations[0]) : (
                                <li key={source} className={styles.group}>
                                    <span className={styles.group_source}>
                                        {source} · {migrations.length}
                                    </span>
                                    <ul className={styles.migration_list}>
                                        {migrations.map(renderPending)}
                                    </ul>
                                </li>
                            )
                        ))}
                    </ul>
                )}
            </Panel>

            <Panel
                title="Migration history"
                meta={history ? `${filteredHistory.length.toLocaleString()} runs` : undefined}
                actions={(
                    <Pagination
                        total={filteredHistory.length}
                        pageSize={HISTORY_PAGE_SIZE}
                        currentPage={currentPage}
                        onPageChange={setPage}
                    />
                )}
            >
                <div className={styles.filters}>
                    <Select
                        value={statusFilter}
                        onChange={(e) => {
                            setStatusFilter(e.target.value as HistoryStatusFilter);
                            setPage(1);
                        }}
                        aria-label="Filter by status"
                    >
                        <option value="all">All statuses</option>
                        <option value="completed">Completed</option>
                        <option value="failed">Failed</option>
                    </Select>
                    <Select
                        value={sourceFilter}
                        onChange={(e) => {
                            setSourceFilter(e.target.value);
                            setPage(1);
                        }}
                        aria-label="Filter by source"
                    >
                        <option value="all">All sources</option>
                        {uniqueSources.map((source) => (
                            <option key={source} value={source}>
                                {source}
                            </option>
                        ))}
                    </Select>
                </div>

                {filteredHistory.length === 0 ? (
                    <p className={styles.empty}>
                        <AlertCircle size={14} aria-hidden="true" />
                        No migration history
                    </p>
                ) : (
                    <Table variant="compact" flush stackAt="mobile">
                        <Thead>
                            <Tr>
                                <Th scope="col" width="expand">Migration</Th>
                                <Th scope="col" width="shrink">Status</Th>
                                <Th scope="col" width="shrink">Executed</Th>
                                <Th scope="col" width="shrink" numeric>Duration</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {pageRows.map((migration) => {
                                const runKey = `${migration.migrationId}-${migration.executedAt}`;
                                const isExpanded = expandedErrors.has(runKey);
                                return (
                                    <Fragment key={runKey}>
                                        <Tr hasError={migration.status === 'failed'}>
                                            <Td>
                                                <code className={styles.cell_id}>{breakableId(migration.migrationId)}</code>
                                            </Td>
                                            <Td label="Status">
                                                <span className={styles.status_cell}>
                                                    {migration.status === 'completed' ? (
                                                        <Badge tone="success" size="xs">
                                                            <CheckCircle size={12} aria-hidden />
                                                            Completed
                                                        </Badge>
                                                    ) : (
                                                        <Badge tone="danger" size="xs">
                                                            <XCircle size={12} aria-hidden />
                                                            Failed
                                                        </Badge>
                                                    )}
                                                    {migration.error && (
                                                        <Button
                                                            variant="ghost"
                                                            size="xs"
                                                            onClick={() => toggleErrorExpansion(runKey)}
                                                            aria-expanded={isExpanded}
                                                        >
                                                            {isExpanded ? 'Hide error' : 'Show error'}
                                                        </Button>
                                                    )}
                                                </span>
                                            </Td>
                                            <Td label="Executed" muted>
                                                <ClientTime date={migration.executedAt} format="short" />
                                            </Td>
                                            <Td label="Duration" numeric muted>{formatMs(migration.executionDuration)}</Td>
                                        </Tr>
                                        {migration.error && isExpanded && (
                                            <Tr isExpanded>
                                                <Td colSpan={HISTORY_COLUMNS}>
                                                    <div className={styles.error_details}>
                                                        <p className={styles.error_message}>{migration.error}</p>
                                                        {migration.errorStack && (
                                                            <pre className={styles.error_stack}>
                                                                {migration.errorStack}
                                                            </pre>
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
            </Panel>
        </>
    );
}
