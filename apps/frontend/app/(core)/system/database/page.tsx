'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSystemAuth } from '../../../../features/system';
import { Page } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { Database, Play, CheckCircle, XCircle, AlertCircle, RefreshCw, FileSearch } from 'lucide-react';
import { DatabaseHealthCards } from './DatabaseHealthCards';
import { CollectionBrowser } from './components/CollectionBrowser';
import styles from './page.module.css';

type TabType = 'browser' | 'migrations';

/**
 * Migration metadata structure returned from API.
 *
 * Describes a discovered migration file with source information and dependencies.
 */
interface IMigrationMetadata {
    id: string;
    description: string;
    source: string;
    filePath: string;
    timestamp: Date;
    dependencies: string[];
    checksum?: string;
}

/**
 * Migration execution record structure.
 *
 * Tracks when and how a migration was executed, including success/failure status.
 */
interface IMigrationExecution {
    migrationId: string;
    status: 'completed' | 'failed';
    source: string;
    executedAt: Date;
    executionDuration: number;
    error?: string;
    errorStack?: string;
    checksum?: string;
    environment?: string;
    codebaseVersion?: string;
}

/**
 * API response for migration status endpoint.
 */
interface IMigrationStatus {
    pending: IMigrationMetadata[];
    completed: string[];
    isRunning: boolean;
    totalPending: number;
    totalCompleted: number;
}

/**
 * API response for migration history endpoint.
 */
interface IMigrationHistory {
    migrations: IMigrationExecution[];
    total: number;
}

/**
 * API response for execute migration endpoint.
 */
interface IExecuteResponse {
    success: boolean;
    executed: string[];
    failed?: {
        migrationId: string;
        error: string;
    };
}

/**
 * Database migration admin page.
 *
 * Provides complete UI for managing database migrations including:
 * - Viewing pending migrations with dependency visualization
 * - Executing individual or all pending migrations
 * - Viewing migration history with filtering
 * - Auto-refresh toggle for live updates
 * - Status badges and error detail expansion
 *
 * Requires admin authentication via system layout.
 */
export default function DatabaseMigrationPage() {
    const { token } = useSystemAuth();
    const [activeTab, setActiveTab] = useState<TabType>('browser');
    const [status, setStatus] = useState<IMigrationStatus | null>(null);
    const [history, setHistory] = useState<IMigrationHistory | null>(null);
    const [loading, setLoading] = useState(true);
    const [executing, setExecuting] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'failed'>('all');
    const [sourceFilter, setSourceFilter] = useState<string>('all');
    const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    /**
     * Fetch migration status from API.
     *
     * Retrieves pending migrations, completed count, and running state. Updates
     * component state and handles errors gracefully with user-visible messages.
     */
    const fetchStatus = useCallback(async () => {
        if (!token) return;

        try {
            const response = await fetch('/api/admin/migrations/status', {
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch status: ${response.statusText}`);
            }

            const data: IMigrationStatus = await response.json();
            setStatus(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch migration status');
        }
    }, [token]);

    /**
     * Fetch migration history with optional filtering.
     *
     * Retrieves completed/failed migration records with status and source filtering.
     * Supports pagination via limit parameter (defaulted to 100).
     */
    const fetchHistory = useCallback(async () => {
        if (!token) return;

        try {
            const params = new URLSearchParams({
                limit: '100',
                status: statusFilter
            });

            const response = await fetch(`/api/admin/migrations/history?${params}`, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch history: ${response.statusText}`);
            }

            const data: IMigrationHistory = await response.json();
            setHistory(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch migration history');
        }
    }, [token, statusFilter]);

    /**
     * Execute one or all pending migrations.
     *
     * Sends POST request to execute endpoint with optional migrationId. Handles
     * 409 conflicts (already running), displays success/error messages via toast,
     * and refreshes status/history after completion.
     *
     * @param migrationId - Optional ID to execute single migration, omit for all
     */
    const executeMigration = async (migrationId?: string) => {
        if (!token || executing) return;

        setExecuting(true);
        setError(null);

        try {
            const response = await fetch('/api/admin/migrations/execute', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                },
                body: JSON.stringify(migrationId ? { migrationId } : {})
            });

            if (response.status === 409) {
                setError('Migration is already running. Please wait for it to complete.');
                return;
            }

            if (!response.ok) {
                throw new Error(`Failed to execute migration: ${response.statusText}`);
            }

            const data: IExecuteResponse = await response.json();

            if (data.success) {
                // Refresh both status and history
                await Promise.all([fetchStatus(), fetchHistory()]);
            } else if (data.failed) {
                setError(`Migration failed: ${data.failed.error}`);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to execute migration');
        } finally {
            setExecuting(false);
        }
    };

    /**
     * Toggle error details expansion for a migration.
     *
     * Maintains set of expanded migration IDs to show/hide error stack traces.
     *
     * @param migrationId - ID of migration to toggle
     */
    const toggleErrorExpansion = (migrationId: string) => {
        setExpandedErrors(prev => {
            const next = new Set(prev);
            if (next.has(migrationId)) {
                next.delete(migrationId);
            } else {
                next.add(migrationId);
            }
            return next;
        });
    };

    // Initial data load
    useEffect(() => {
        if (!token) return;

        const loadData = async () => {
            setLoading(true);
            await Promise.all([fetchStatus(), fetchHistory()]);
            setLoading(false);
        };

        void loadData();
    }, [token, fetchStatus, fetchHistory]);

    // Auto-refresh polling
    useEffect(() => {
        if (!autoRefresh || !token) return;

        const interval = setInterval(() => {
            void fetchStatus();
        }, 5000);

        return () => clearInterval(interval);
    }, [autoRefresh, token, fetchStatus]);

    // Refetch history when filter changes
    useEffect(() => {
        if (token) {
            void fetchHistory();
        }
    }, [statusFilter, fetchHistory, token]);

    /**
     * Get unique sources from history for filter dropdown.
     */
    const uniqueSources = history
        ? Array.from(new Set(history.migrations.map(m => m.source))).sort()
        : [];

    /**
     * Filter history based on current source filter.
     */
    const filteredHistory = history
        ? sourceFilter === 'all'
            ? history.migrations
            : history.migrations.filter(m => m.source === sourceFilter)
        : [];

    /**
     * Group pending migrations by source for expandable sections.
     */
    const groupedPending = status?.pending.reduce((acc, migration) => {
        if (!acc[migration.source]) {
            acc[migration.source] = [];
        }
        acc[migration.source].push(migration);
        return acc;
    }, {} as Record<string, IMigrationMetadata[]>) || {};

    if (loading) {
        return (
            <Page>
                <Card>
                    <p>Loading migration data...</p>
                </Card>
            </Page>
        );
    }

    return (
        <Page>
            {/* Database Health Cards */}
            <DatabaseHealthCards token={token} />

            {/* Tab Navigation */}
            <Card padding="md">
                <div className={styles.tabs}>
                    <button
                        className={`${styles.tab} ${activeTab === 'browser' ? styles.tab_active : ''}`}
                        onClick={() => setActiveTab('browser')}
                        aria-selected={activeTab === 'browser'}
                    >
                        <FileSearch size={16} />
                        Browser
                    </button>
                    <button
                        className={`${styles.tab} ${activeTab === 'migrations' ? styles.tab_active : ''}`}
                        onClick={() => setActiveTab('migrations')}
                        aria-selected={activeTab === 'migrations'}
                    >
                        <Database size={16} />
                        Migrations
                    </button>
                </div>
            </Card>

            {/* Tab Content */}
            {activeTab === 'browser' && (
                <CollectionBrowser token={token} />
            )}

            {activeTab === 'migrations' && (
                <>

            {/* Header with System Status */}
            <Card padding="lg">
                <div className={styles.header}>
                    <div className={styles.header_info}>
                        <Database size={32} className={styles.header_icon} />
                        <div>
                            <h2 className={styles.header_title}>Database Migrations</h2>
                            <p className={styles.header_subtitle}>
                                Manage and monitor database schema migrations
                            </p>
                        </div>
                    </div>
                    <div className={styles.header_stats}>
                        <div className={styles.stat}>
                            <span className={styles.stat_label}>Pending</span>
                            <span className={styles.stat_value}>{status?.totalPending || 0}</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.stat_label}>Completed</span>
                            <span className={styles.stat_value}>{status?.totalCompleted || 0}</span>
                        </div>
                        <div className={styles.stat}>
                            <span className={styles.stat_label}>Status</span>
                            {status?.isRunning ? (
                                <Badge tone="warning">Running</Badge>
                            ) : (
                                <Badge tone="success">Ready</Badge>
                            )}
                        </div>
                    </div>
                </div>
                <div className={styles.header_actions}>
                    <Button
                        variant="primary"
                        size="lg"
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
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        icon={<RefreshCw size={16} />}
                    >
                        {autoRefresh ? 'Auto-refresh On' : 'Auto-refresh Off'}
                    </Button>
                </div>
            </Card>

            {/* Error Display */}
            {error && (
                <Card tone="muted" padding="md">
                    <div className={styles.error_banner}>
                        <AlertCircle size={20} />
                        <span>{error}</span>
                    </div>
                </Card>
            )}

            {/* Pending Migrations */}
            <Card padding="lg">
                <h3 className={styles.section_title}>Pending Migrations</h3>
                {status && status.totalPending === 0 ? (
                    <div className={styles.empty_state}>
                        <CheckCircle size={48} className={styles.empty_icon} />
                        <p>No pending migrations</p>
                    </div>
                ) : (
                    <div className={styles.pending_groups}>
                        {Object.entries(groupedPending).map(([source, migrations]) => (
                            <details key={source} className={styles.pending_group} open>
                                <summary className={styles.group_header}>
                                    <span className={styles.group_title}>{source}</span>
                                    <Badge tone="neutral">{migrations.length}</Badge>
                                </summary>
                                <div className={styles.migrations_list}>
                                    {migrations.map(migration => (
                                        <div key={migration.id} className={styles.migration_row}>
                                            <div className={styles.migration_info}>
                                                <span className={styles.migration_id}>{migration.id}</span>
                                                <span className={styles.migration_description}>
                                                    {migration.description}
                                                </span>
                                                {migration.dependencies.length > 0 && (
                                                    <div className={styles.migration_deps}>
                                                        <span className={styles.deps_label}>Depends on:</span>
                                                        {migration.dependencies.map(dep => (
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
                                        </div>
                                    ))}
                                </div>
                            </details>
                        ))}
                    </div>
                )}
            </Card>

            {/* Migration History */}
            <Card padding="lg">
                <div className={styles.history_header}>
                    <h3 className={styles.section_title}>Migration History</h3>
                    <div className={styles.filters}>
                        <select
                            value={statusFilter}
                            onChange={e => setStatusFilter(e.target.value as 'all' | 'completed' | 'failed')}
                            className={styles.filter_select}
                            aria-label="Filter by status"
                        >
                            <option value="all">All Status</option>
                            <option value="completed">Completed</option>
                            <option value="failed">Failed</option>
                        </select>
                        <select
                            value={sourceFilter}
                            onChange={e => setSourceFilter(e.target.value)}
                            className={styles.filter_select}
                            aria-label="Filter by source"
                        >
                            <option value="all">All Sources</option>
                            {uniqueSources.map(source => (
                                <option key={source} value={source}>
                                    {source}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                <div className={styles.history_table}>
                    {filteredHistory.length === 0 ? (
                        <div className={styles.empty_state}>
                            <AlertCircle size={48} className={styles.empty_icon} />
                            <p>No migration history</p>
                        </div>
                    ) : (
                        <table className={styles.table}>
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
                                {filteredHistory.map(migration => {
                                    const isExpanded = expandedErrors.has(migration.migrationId);
                                    return (
                                        <tr key={`${migration.migrationId}-${migration.executedAt}`}>
                                            <td className={styles.cell_id}>{migration.migrationId}</td>
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
                                            <td>{new Date(migration.executedAt).toLocaleString()}</td>
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
                                                    <span className={styles.no_error}>-</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
            </Card>
            </>
            )}
        </Page>
    );
}
