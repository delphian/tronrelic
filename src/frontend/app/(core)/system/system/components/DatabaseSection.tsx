'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Database,
    Activity,
    Layers,
    HardDrive,
    Zap,
    Play,
    CheckCircle,
    XCircle,
    AlertCircle,
    RefreshCw
} from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack, Grid } from '../../../../../components/layout';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { config as runtimeConfig } from '../../../../../lib/config';
import { HealthMetric } from './HealthMetric';
import { CollectionBrowser } from './CollectionBrowser';
import styles from './DatabaseSection.module.scss';

interface Props {
    token: string;
}

interface DatabaseStatus {
    connected: boolean;
    responseTime: number | null;
    poolSize: number;
    availableConnections: number;
    databaseSize: number | null;
    collectionCount: number;
    recentErrors: string[];
}

interface ClickHouseStatus {
    connected: boolean;
    responseTime: number | null;
    tableCount: number;
    databaseSize: number | null;
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
    /**
     * ISO-8601 timestamp string. Typed as `string` (not `Date`) because the
     * value crosses the wire as JSON — `JSON.parse` never produces Date
     * instances, and a stale `Date` typing would coerce to "[object Object]"
     * inside template-literal keys.
     */
    executedAt: string;
    executionDuration: number;
    error?: string;
    errorStack?: string;
}

interface IMigrationStatus {
    pending: IMigrationMetadata[];
    completed: string[];
    isRunning: boolean;
    totalPending: number;
    totalCompleted: number;
}

interface IMigrationHistory {
    migrations: IMigrationExecution[];
    total: number;
}

/**
 * Database administration body — health, migrations, and collection browser.
 *
 * Rendered inside a CollapsibleSection — this component only mounts when
 * the section is expanded, which means health polling, migration status
 * fetches, and collection-browser stats stay quiet until the admin opens
 * the section.
 */
export function DatabaseSection({ token }: Props) {
    return (
        <Stack gap="lg">
            <DatabaseHealth token={token} />
            <Migrations token={token} />
            <Browser token={token} />
        </Stack>
    );
}

function DatabaseHealth({ token }: { token: string }) {
    const [database, setDatabase] = useState<DatabaseStatus | null>(null);
    const [clickhouse, setClickhouse] = useState<ClickHouseStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const [mongoResponse, clickhouseResponse] = await Promise.all([
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/health/database`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/health/clickhouse`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            // Each backend returns its own status independently; surface the
            // failure (and clear stale data) per-backend so a transient
            // outage doesn't keep showing "Connected" forever.
            if (mongoResponse.ok) {
                const mongoData = await mongoResponse.json();
                setDatabase(mongoData.status);
            } else {
                setDatabase(null);
            }
            if (clickhouseResponse.ok) {
                const clickhouseData = await clickhouseResponse.json();
                setClickhouse(clickhouseData.status);
            } else {
                setClickhouse(null);
            }

            if (!mongoResponse.ok && !clickhouseResponse.ok) {
                throw new Error(
                    `Health endpoints unavailable (mongo ${mongoResponse.status}, clickhouse ${clickhouseResponse.status})`
                );
            }
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch database health');
        }
    }, [token]);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    return (
        <section className={styles.subsection}>
            <h3 className={styles.subsection_title}>Health</h3>
            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={16} aria-hidden="true" />
                        {error}
                    </span>
                </div>
            )}
            {database && (
                <Stack gap="sm">
                    <h4 className={styles.subsection_subtitle}>MongoDB</h4>
                    <Grid columns="responsive" gap="sm">
                        <HealthMetric
                            icon={<Database size={20} />}
                            label="Status"
                            value={database.connected ? 'Connected' : 'Disconnected'}
                            tone={database.connected ? 'success' : 'danger'}
                        />
                        {database.responseTime !== null && (
                            <HealthMetric
                                icon={<Activity size={20} />}
                                label="Response Time"
                                value={`${database.responseTime}ms`}
                            />
                        )}
                        <HealthMetric
                            icon={<Layers size={20} />}
                            label="Collections"
                            value={database.collectionCount.toLocaleString()}
                        />
                        {database.databaseSize !== null && (
                            <HealthMetric
                                icon={<HardDrive size={20} />}
                                label="Size"
                                value={formatBytes(database.databaseSize)}
                            />
                        )}
                    </Grid>
                </Stack>
            )}
            {clickhouse && (
                <Stack gap="sm">
                    <h4 className={styles.subsection_subtitle}>ClickHouse</h4>
                    <Grid columns="responsive" gap="sm">
                        <HealthMetric
                            icon={<Zap size={20} />}
                            label="Status"
                            value={clickhouse.connected ? 'Connected' : 'Disconnected'}
                            tone={clickhouse.connected ? 'success' : 'danger'}
                        />
                        {clickhouse.responseTime !== null && (
                            <HealthMetric
                                icon={<Activity size={20} />}
                                label="Response Time"
                                value={`${clickhouse.responseTime}ms`}
                            />
                        )}
                        <HealthMetric
                            icon={<Layers size={20} />}
                            label="Tables"
                            value={clickhouse.tableCount.toLocaleString()}
                        />
                        {clickhouse.databaseSize !== null && (
                            <HealthMetric
                                icon={<HardDrive size={20} />}
                                label="Size"
                                value={formatBytes(clickhouse.databaseSize)}
                            />
                        )}
                    </Grid>
                </Stack>
            )}
        </section>
    );
}

function Migrations({ token }: { token: string }) {
    const [status, setStatus] = useState<IMigrationStatus | null>(null);
    const [history, setHistory] = useState<IMigrationHistory | null>(null);
    const [executing, setExecuting] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed'>('all');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    // SystemAuthGate guarantees a non-empty token, so the helpers do not
    // gate on token. URLs and the auth header follow docs/system/system-api.md
    // (X-Admin-Token, ${runtimeConfig.apiBaseUrl}/...).

    const fetchStatus = useCallback(async () => {
        try {
            const response = await fetch(`${runtimeConfig.apiBaseUrl}/admin/migrations/status`, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                }
            });
            if (!response.ok) throw new Error(`Failed to fetch status: ${response.statusText}`);
            const data: IMigrationStatus = await response.json();
            setStatus(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch migration status');
        }
    }, [token]);

    const fetchHistory = useCallback(async () => {
        try {
            const params = new URLSearchParams({ limit: '100', status: statusFilter });
            const response = await fetch(`${runtimeConfig.apiBaseUrl}/admin/migrations/history?${params}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                }
            });
            if (!response.ok) throw new Error(`Failed to fetch history: ${response.statusText}`);
            const data: IMigrationHistory = await response.json();
            setHistory(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch migration history');
        }
    }, [token, statusFilter]);

    const executeMigration = async (migrationId?: string) => {
        if (executing) return;
        setExecuting(true);
        setError(null);
        try {
            const response = await fetch(`${runtimeConfig.apiBaseUrl}/admin/migrations/execute`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify(migrationId ? { migrationId } : {})
            });
            if (response.status === 409) {
                setError('Migration is already running. Please wait for it to complete.');
                return;
            }
            if (!response.ok) throw new Error(`Failed to execute migration: ${response.statusText}`);
            const data = await response.json();
            // Per docs/system/system-database-migrations.md, a 2xx response
            // always carries either `success` (on completion) or `failed` (on
            // a tracked failure). Anything else is an unexpected shape — fail
            // loudly rather than silently no-op.
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

    // Single source of truth for fetches:
    // - fetchStatus runs whenever its identity changes (token).
    // - fetchHistory runs whenever its identity changes (token, statusFilter).
    // Splitting them into separate effects prevents the previous bug where a
    // statusFilter change re-fired fetchHistory twice (once via this effect,
    // once via a second effect that also depended on fetchHistory).
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
        <section className={styles.subsection}>
            <div className={styles.subsection_header}>
                <h3 className={styles.subsection_title}>Migrations</h3>
                <Grid columns="responsive" gap="sm">
                    <HealthMetric
                        icon={<Database size={20} />}
                        label="Pending"
                        value={(status?.totalPending ?? 0).toLocaleString()}
                    />
                    <HealthMetric
                        icon={<CheckCircle size={20} />}
                        label="Completed"
                        value={(status?.totalCompleted ?? 0).toLocaleString()}
                    />
                    <HealthMetric
                        icon={<Activity size={20} />}
                        label="Status"
                        value={
                            status?.isRunning ? (
                                <Badge tone="warning">Running</Badge>
                            ) : (
                                <Badge tone="success">Ready</Badge>
                            )
                        }
                    />
                </Grid>
                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        size="md"
                        onClick={() => void executeMigration()}
                        disabled={executing || status?.isRunning || !status?.totalPending}
                        loading={executing}
                        icon={<Play size={18} />}
                    >
                        Execute All Pending
                    </Button>
                    <Button
                        variant="secondary"
                        size="md"
                        onClick={() => setAutoRefresh((prev) => !prev)}
                        icon={<RefreshCw size={16} />}
                    >
                        {autoRefresh ? 'Auto-refresh On' : 'Auto-refresh Off'}
                    </Button>
                </div>
            </div>

            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={16} aria-hidden="true" />
                        {error}
                    </span>
                </div>
            )}

            <div>
                <h4 className={styles.subsection_subtitle}>Pending</h4>
                {status && status.totalPending === 0 ? (
                    <p className={styles.empty}>
                        <CheckCircle size={18} aria-hidden="true" />
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
                                                        <span className={styles.deps_label}>Depends on:</span>
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
                                                size="sm"
                                                onClick={() => void executeMigration(migration.id)}
                                                disabled={executing || status?.isRunning}
                                                icon={<Play size={14} />}
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

            <div>
                <div className={styles.history_header}>
                    <h4 className={styles.subsection_subtitle}>History</h4>
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
                </div>
                <div className={styles.history_table_wrap}>
                    {filteredHistory.length === 0 ? (
                        <p className={styles.empty}>
                            <AlertCircle size={18} aria-hidden="true" />
                            No migration history
                        </p>
                    ) : (
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Migration ID</th>
                                    <th>Status</th>
                                    <th>Executed At</th>
                                    <th>Duration</th>
                                    <th>Source</th>
                                    <th>Error</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredHistory.map((migration) => {
                                    const isExpanded = expandedErrors.has(migration.migrationId);
                                    return (
                                        <tr key={`${migration.migrationId}-${migration.executedAt}`}>
                                            <td>
                                                <code className={styles.cell_id}>{migration.migrationId}</code>
                                            </td>
                                            <td>
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
                                            </td>
                                            <td>
                                                <ClientTime date={migration.executedAt} format="short" />
                                            </td>
                                            <td>{migration.executionDuration}ms</td>
                                            <td>
                                                <Badge tone="neutral">{migration.source}</Badge>
                                            </td>
                                            <td>
                                                {migration.error ? (
                                                    <div className={styles.error_cell}>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => toggleErrorExpansion(migration.migrationId)}
                                                        >
                                                            {isExpanded ? 'Hide' : 'Show'} Error
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
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </section>
    );
}

function Browser({ token }: { token: string }) {
    return (
        <section className={styles.subsection}>
            <h3 className={styles.subsection_title}>Collection Browser</h3>
            <CollectionBrowser token={token} />
        </section>
    );
}

function formatBytes(bytes: number): string {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
}
