'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    AlertCircle,
    CheckCircle,
    Play,
    RefreshCw,
    XCircle
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { formatBytes } from '../../../../../lib/format';
import { StatStrip } from './StatStrip';
import { CollectionBrowser } from './CollectionBrowser';
import styles from './MongoSection.module.scss';

interface DatabaseStatus {
    connected: boolean;
    responseTime: number | null;
    poolSize: number;
    availableConnections: number;
    databaseSize: number | null;
    collectionCount: number;
    recentErrors: string[];
}

interface IMigrationMetadata {
    id: string;
    description: string;
    source: string;
    filePath: string;
    timestamp: string;
    dependencies: string[];
    checksum?: string;
}

interface IMigrationExecution {
    migrationId: string;
    status: 'completed' | 'failed';
    source: string;
    executedAt: string;
    executionDuration: number;
    error?: string;
    errorStack?: string;
}

interface IMigrationStatus {
    pending: IMigrationMetadata[];
    completed: IMigrationExecution[];
    isRunning: boolean;
    totalPending: number;
    totalCompleted: number;
}

interface IMigrationHistory {
    migrations: IMigrationExecution[];
    total: number;
}

/**
 * MongoDB administration body — health, migrations, and the collection browser.
 *
 * Migrations live here because the `migrations` audit log is stored in
 * MongoDB; the executor still dispatches ClickHouse-targeted migrations
 * to the ClickHouse engine, but the operator-facing record of what ran
 * and when belongs to Mongo. ClickHouse health and the table browser
 * are a separate console row (see ClickHouseSection).
 */
export function MongoSection() {
    return (
        <div className={styles.subsection}>
            <MongoHealth />
            <Migrations />
            <Browser />
        </div>
    );
}

function MongoHealth() {
    const [database, setDatabase] = useState<DatabaseStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const runtimeConfig = getRuntimeConfig();

    const fetchData = useCallback(async () => {
        try {
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/system/health/database`);

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
    }, [runtimeConfig.apiUrl]);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    return (
        <div className={styles.block}>
            <h4 className={styles.block_title}>Health</h4>
            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={14} aria-hidden="true" />
                        {error}
                    </span>
                </div>
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
        </div>
    );
}

function Migrations() {
    const [status, setStatus] = useState<IMigrationStatus | null>(null);
    const [history, setHistory] = useState<IMigrationHistory | null>(null);
    const [executing, setExecuting] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed'>('all');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const runtimeConfig = getRuntimeConfig();

    const fetchStatus = useCallback(async () => {
        try {
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/migrations/status`, {
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error(`Failed to fetch status: ${response.statusText}`);
            const data: IMigrationStatus = await response.json();
            setStatus(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch migration status');
        }
    }, [runtimeConfig.apiUrl]);

    const fetchHistory = useCallback(async () => {
        try {
            const params = new URLSearchParams({ limit: '100', status: statusFilter });
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/migrations/history?${params}`, {
                headers: { 'Content-Type': 'application/json' }
            });
            if (!response.ok) throw new Error(`Failed to fetch history: ${response.statusText}`);
            const data: IMigrationHistory = await response.json();
            setHistory(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch migration history');
        }
    }, [statusFilter, runtimeConfig.apiUrl]);

    const executeMigration = async (migrationId?: string) => {
        if (executing) return;
        setExecuting(true);
        setError(null);
        try {
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/migrations/execute`, {
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

    const toggleErrorExpansion = (migrationId: string) => {
        setExpandedErrors((prev) => {
            const next = new Set(prev);
            if (next.has(migrationId)) next.delete(migrationId);
            else next.add(migrationId);
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

    const groupedPending = useMemo(
        () =>
            status?.pending.reduce((acc, migration) => {
                if (!acc[migration.source]) acc[migration.source] = [];
                acc[migration.source].push(migration);
                return acc;
            }, {} as Record<string, IMigrationMetadata[]>) || {},
        [status?.pending]
    );

    return (
        <div className={styles.block}>
            <header className={styles.block_header}>
                <h4 className={styles.block_title}>Migrations</h4>
                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        size="xs"
                        onClick={() => void executeMigration()}
                        disabled={executing || status?.isRunning || !status?.totalPending}
                        loading={executing}
                        icon={<Play size={14} />}
                    >
                        Execute Pending
                    </Button>
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setAutoRefresh((prev) => !prev)}
                        icon={<RefreshCw size={14} />}
                    >
                        {autoRefresh ? 'Auto-refresh On' : 'Auto-refresh Off'}
                    </Button>
                </div>
            </header>

            <StatStrip
                items={[
                    { label: 'Pending', value: (status?.totalPending ?? 0).toLocaleString() },
                    { label: 'Completed', value: (status?.totalCompleted ?? 0).toLocaleString() },
                    {
                        label: 'Status',
                        value: status?.isRunning ? 'Running' : 'Ready',
                        tone: status?.isRunning ? 'warning' : 'success'
                    }
                ]}
            />

            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={14} aria-hidden="true" />
                        {error}
                    </span>
                </div>
            )}

            <div className={styles.subblock}>
                <h5 className={styles.subblock_title}>Pending</h5>
                {status && status.totalPending === 0 ? (
                    <p className={styles.empty}>
                        <CheckCircle size={14} aria-hidden="true" />
                        No pending migrations
                    </p>
                ) : (
                    <div className={styles.pending_groups}>
                        {Object.entries(groupedPending).map(([source, migrations]) => (
                            <details key={source} className={styles.group} open>
                                <summary className={styles.group_summary}>
                                    <span className={styles.group_source}>{source}</span>
                                    <Badge tone="neutral">{migrations.length}</Badge>
                                </summary>
                                <ul className={styles.migration_list}>
                                    {migrations.map((migration) => (
                                        <li key={migration.id} className={styles.migration_row}>
                                            <div className={styles.migration_info}>
                                                <code className={styles.migration_id}>{migration.id}</code>
                                                <span className={styles.migration_description}>
                                                    {migration.description}
                                                </span>
                                                {migration.dependencies.length > 0 && (
                                                    <div className={styles.migration_deps}>
                                                        <span className={styles.deps_label}>Depends:</span>
                                                        {migration.dependencies.map((dep) => (
                                                            <Badge key={dep} tone="neutral">
                                                                {dep}
                                                            </Badge>
                                                        ))}
                                                    </div>
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
                                    ))}
                                </ul>
                            </details>
                        ))}
                    </div>
                )}
            </div>

            <div className={styles.subblock}>
                <header className={styles.history_header}>
                    <h5 className={styles.subblock_title}>History</h5>
                    <div className={styles.filters}>
                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'completed' | 'failed')}
                            className={styles.select}
                            aria-label="Filter by status"
                        >
                            <option value="all">All Status</option>
                            <option value="completed">Completed</option>
                            <option value="failed">Failed</option>
                        </select>
                        <select
                            value={sourceFilter}
                            onChange={(e) => setSourceFilter(e.target.value)}
                            className={styles.select}
                            aria-label="Filter by source"
                        >
                            <option value="all">All Sources</option>
                            {uniqueSources.map((source) => (
                                <option key={source} value={source}>
                                    {source}
                                </option>
                            ))}
                        </select>
                    </div>
                </header>
                <div className={styles.history_table_wrap}>
                    {filteredHistory.length === 0 ? (
                        <p className={styles.empty}>
                            <AlertCircle size={14} aria-hidden="true" />
                            No migration history
                        </p>
                    ) : (
                        <Table variant="compact">
                            <Thead>
                                <Tr>
                                    <Th>Migration ID</Th>
                                    <Th>Status</Th>
                                    <Th>Executed At</Th>
                                    <Th>Duration</Th>
                                    <Th>Source</Th>
                                    <Th>Error</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {filteredHistory.map((migration) => {
                                    const isExpanded = expandedErrors.has(migration.migrationId);
                                    return (
                                        <Tr key={`${migration.migrationId}-${migration.executedAt}`}>
                                            <Td>
                                                <code className={styles.cell_id}>{migration.migrationId}</code>
                                            </Td>
                                            <Td>
                                                {migration.status === 'completed' ? (
                                                    <Badge tone="success">
                                                        <CheckCircle size={12} />
                                                        Completed
                                                    </Badge>
                                                ) : (
                                                    <Badge tone="danger">
                                                        <XCircle size={12} />
                                                        Failed
                                                    </Badge>
                                                )}
                                            </Td>
                                            <Td muted>
                                                <ClientTime date={migration.executedAt} format="short" />
                                            </Td>
                                            <Td muted>{migration.executionDuration}ms</Td>
                                            <Td>
                                                <Badge tone="neutral">{migration.source}</Badge>
                                            </Td>
                                            <Td>
                                                {migration.error ? (
                                                    <div className={styles.error_cell}>
                                                        <Button
                                                            variant="ghost"
                                                            size="xs"
                                                            onClick={() => toggleErrorExpansion(migration.migrationId)}
                                                        >
                                                            {isExpanded ? 'Hide' : 'Show'}
                                                        </Button>
                                                        {isExpanded && (
                                                            <div className={styles.error_details}>
                                                                <p className={styles.error_message}>{migration.error}</p>
                                                                {migration.errorStack && (
                                                                    <pre className={styles.error_stack}>
                                                                        {migration.errorStack}
                                                                    </pre>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-subtle">—</span>
                                                )}
                                            </Td>
                                        </Tr>
                                    );
                                })}
                            </Tbody>
                        </Table>
                    )}
                </div>
            </div>
        </div>
    );
}

function Browser() {
    return (
        <div className={styles.block}>
            <h4 className={styles.block_title}>Collection Browser</h4>
            <CollectionBrowser />
        </div>
    );
}

