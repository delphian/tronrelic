'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import type { LogLevel } from '@/types';
import { Button } from '../../../../components/ui/Button';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import { Stack } from '../../../../components/layout';
import { getSystemLogs, getLogStats, deleteAllLogs } from '../../api';
import type { SystemLog, LogStats } from '../../types';
import styles from './SystemLogsMonitor.module.scss';

interface Props {
    token: string;
}

/**
 * SystemLogsMonitor Component
 *
 * Admin diagnostic tool for monitoring ERROR and WARN logs captured from the backend.
 * Displays paginated logs with filtering, live polling, and bulk operations.
 *
 * **Key Features:**
 * - Severity level filtering (ERROR, WARN, INFO, DEBUG)
 * - Service/plugin filtering via dropdown populated from log statistics
 * - Configurable live polling (None, 1s, 10s, 30s, 60s)
 * - Pagination with configurable page size
 * - Clear all logs functionality
 * - Expandable log details with context
 *
 * **Data Sources:**
 * - `/admin/system/logs` - Paginated logs with filtering
 * - `/admin/system/logs/stats` - Log statistics and service list
 *
 * **Security:**
 * Requires admin token authentication via X-Admin-Token header.
 *
 * @param {Props} props - Component props
 * @param {string} props.token - Admin authentication token for API requests
 */
export function SystemLogsMonitor({ token }: Props) {
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [stats, setStats] = useState<LogStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [total, setTotal] = useState(0);
    const [totalPages, setTotalPages] = useState(0);
    const [hasNextPage, setHasNextPage] = useState(false);
    const [hasPrevPage, setHasPrevPage] = useState(false);

    // Filters
    const [selectedLevels, setSelectedLevels] = useState<LogLevel[]>(['error']);
    const [serviceFilter, setServiceFilter] = useState('');

    // Live polling (interval in milliseconds, 0 means disabled)
    const [pollingInterval, setPollingInterval] = useState(10000);

    // Expandable log details
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    // Track new logs for flash animation
    const [newLogIds, setNewLogIds] = useState<Set<string>>(new Set());
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const logsRef = useRef<SystemLog[]>([]);
    const isInitialLoadRef = useRef(true);
    const flashedLogsRef = useRef<Set<string>>(new Set());
    const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pendingFlashIdsRef = useRef<Set<string> | null>(null);

    const { push } = useToast();
    const { open, close } = useModal();

    /**
     * Synchronises the initial-load flag between state and ref so polling callbacks
     * always read the latest value when determining whether to flash new rows.
     *
     * @param next - Updated initial load flag
     */
    const setInitialLoadState = useCallback((next: boolean) => {
        isInitialLoadRef.current = next;
        setIsInitialLoad(next);
    }, []);

    /**
     * Fetches logs from the admin API with current filters and pagination.
     *
     * Uses the logs API client to construct and execute the query.
     * Updates component state with fresh data or logs errors on failure.
     */
    const fetchLogs = useCallback(async () => {
        try {
            const data = await getSystemLogs(token, {
                levels: selectedLevels.length > 0 ? selectedLevels : undefined,
                service: serviceFilter.trim() || undefined,
                page,
                limit
            });

            if (data.success) {
                const currentLogs = logsRef.current;
                const initialLoad = isInitialLoadRef.current;

                // Detect new logs if not initial load and we have existing logs
                if (!initialLoad && currentLogs.length > 0) {
                    const currentIds = new Set(currentLogs.map(log => log._id));
                    const incomingIds = new Set(data.logs.map(log => log._id));

                    // Find truly new logs that haven't been flashed before
                    const newIds = new Set(
                        [...incomingIds].filter(id => !currentIds.has(id) && !flashedLogsRef.current.has(id))
                    );

                    if (newIds.size > 0) {
                        // Store pending flash IDs to apply AFTER logs are rendered
                        pendingFlashIdsRef.current = newIds;

                        // Add these IDs to the flashed set so they won't flash again
                        newIds.forEach(id => flashedLogsRef.current.add(id));
                    } else {
                        pendingFlashIdsRef.current = null;
                    }
                } else {
                    pendingFlashIdsRef.current = null;
                }

                // Update logs state
                setLogs(data.logs);
                logsRef.current = data.logs;
                setTotal(data.total);
                setTotalPages(data.totalPages);
                setHasNextPage(data.hasNextPage);
                setHasPrevPage(data.hasPrevPage);
                setInitialLoadState(false);
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        } finally {
            setLoading(false);
        }
    }, [limit, page, selectedLevels, serviceFilter, setInitialLoadState, token]);

    /**
     * Fetches log statistics from the admin API.
     *
     * Provides counts by severity level and service for dashboard metrics
     * and the service filter dropdown.
     */
    const fetchStats = useCallback(async () => {
        try {
            const logStats = await getLogStats(token);
            setStats(logStats);
        } catch (error) {
            console.error('Failed to fetch log stats:', error);
        }
    }, [token]);

    /**
     * Executes the clear-all-logs API call and refreshes state.
     *
     * Called after the user confirms deletion via the confirmation modal.
     * Provides toast feedback on success or failure.
     */
    const executeClearLogs = useCallback(async () => {
        try {
            const deletedCount = await deleteAllLogs(token);
            push({ tone: 'success', title: `Deleted ${deletedCount.toLocaleString()} log entries` });
            setPage(1);
            await fetchLogs();
            await fetchStats();
        } catch {
            push({ tone: 'danger', title: 'Failed to clear logs', description: 'Please try again.' });
        }
    }, [token, push, fetchLogs, fetchStats]);

    /**
     * Opens a confirmation modal before clearing all logs.
     *
     * Uses the ModalProvider system instead of browser-native confirm() for
     * consistent UI and accessibility.
     */
    const handleClearLogs = useCallback(() => {
        const modalId = 'confirm-clear-logs';
        open({
            id: modalId,
            title: 'Clear All Logs',
            content: (
                <Stack gap="md">
                    <p>Are you sure you want to delete all logs? This action cannot be undone.</p>
                    <Stack direction="horizontal" gap="sm">
                        <Button
                            variant="danger"
                            size="sm"
                            icon={<Trash2 size={14} />}
                            onClick={() => {
                                close(modalId);
                                void executeClearLogs();
                            }}
                        >
                            Delete All
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => close(modalId)}>
                            Cancel
                        </Button>
                    </Stack>
                </Stack>
            ),
            size: 'sm'
        });
    }, [open, close, executeClearLogs]);

    /**
     * Toggles a severity level in the filter.
     *
     * Adds or removes the level from selectedLevels array and resets pagination.
     * Clears flash history so logs can flash again after filter changes.
     *
     * @param level - Log level to toggle
     */
    const handleToggleLevel = (level: LogLevel) => {
        setSelectedLevels(prev => {
            if (prev.includes(level)) {
                return prev.filter(l => l !== level);
            } else {
                return [...prev, level];
            }
        });
        setPage(1);
        setInitialLoadState(true);
        flashedLogsRef.current.clear();
    };

    useEffect(() => {
        logsRef.current = logs;
    }, [logs]);

    useEffect(() => {
        isInitialLoadRef.current = isInitialLoad;
    }, [isInitialLoad]);

    // Initial fetch
    useEffect(() => {
        void fetchLogs();
        void fetchStats();
    }, [fetchLogs, fetchStats]);

    // Live polling interval
    useEffect(() => {
        if (pollingInterval === 0) return;

        const interval = setInterval(() => {
            void fetchLogs();
            void fetchStats();
        }, pollingInterval);

        return () => clearInterval(interval);
    }, [fetchLogs, fetchStats, pollingInterval]);

    // Apply flash animation AFTER logs are rendered (two-phase commit)
    useEffect(() => {
        if (pendingFlashIdsRef.current && pendingFlashIdsRef.current.size > 0) {
            // Clear any existing timeout
            if (flashTimeoutRef.current) {
                clearTimeout(flashTimeoutRef.current);
            }

            // Apply flash class in next frame to ensure DOM is updated
            requestAnimationFrame(() => {
                const flashIds = pendingFlashIdsRef.current;
                if (flashIds) {
                    setNewLogIds(flashIds);
                    pendingFlashIdsRef.current = null;

                    // Clear the flash after animation completes
                    flashTimeoutRef.current = setTimeout(() => {
                        setNewLogIds(new Set());
                        flashTimeoutRef.current = null;
                    }, 2000);
                }
            });
        }
    }, [logs]);

    // Cleanup flash timeout on unmount
    useEffect(() => {
        return () => {
            if (flashTimeoutRef.current) {
                clearTimeout(flashTimeoutRef.current);
            }
        };
    }, []);

    /**
     * Formats timestamp to compact military time format.
     *
     * Uses manual formatting rather than ClientTime because this is a client-only
     * component (data fetched after mount, no SSR hydration risk) and the compact
     * "MM/DD/YY HH:mm:ss" format with seconds precision is essential for log analysis.
     * ClientTime does not offer a format with seconds.
     *
     * @param timestamp - ISO 8601 timestamp string
     * @returns Formatted date/time string (MM/DD/YY HH:mm:ss)
     */
    const formatTimestamp = (timestamp: string) => {
        const date = new Date(timestamp);
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2);
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');
        return `${month}/${day}/${year} ${hours}:${minutes}:${seconds}`;
    };

    /**
     * Returns CSS class for log level badge.
     *
     * @param level - Log severity level
     * @returns CSS class name
     */
    const getLevelClass = (level: LogLevel) => {
        switch (level) {
            case 'trace':
                return styles.level_trace;
            case 'error':
                return styles.level_error;
            case 'warn':
                return styles.level_warn;
            case 'info':
                return styles.level_info;
            case 'debug':
                return styles.level_debug;
            default:
                return '';
        }
    };

    if (loading) {
        return <div className={styles.container}>Loading logs...</div>;
    }

    return (
        <div className={styles.container}>
            {/* Statistics */}
            {stats && (
                <div className={styles.stats}>
                    <div className={styles.stat_card}>
                        <div className={styles.stat_label}>Total Logs</div>
                        <div className={styles.stat_value}>{stats.total.toLocaleString()}</div>
                    </div>
                    <div className={styles.stat_card}>
                        <div className={styles.stat_label}>Errors</div>
                        <div className={styles.stat_value}>{stats.byLevel.error.toLocaleString()}</div>
                    </div>
                    <div className={styles.stat_card}>
                        <div className={styles.stat_label}>Warnings</div>
                        <div className={styles.stat_value}>{stats.byLevel.warn.toLocaleString()}</div>
                    </div>
                    <div className={styles.stat_card}>
                        <div className={styles.stat_label}>Info</div>
                        <div className={styles.stat_value}>{stats.byLevel.info.toLocaleString()}</div>
                    </div>
                    <div className={styles.stat_card}>
                        <div className={styles.stat_label}>Debug</div>
                        <div className={styles.stat_value}>{stats.byLevel.debug.toLocaleString()}</div>
                    </div>
                    <div className={styles.stat_card}>
                        <div className={styles.stat_label}>Trace</div>
                        <div className={styles.stat_value}>{stats.byLevel.trace?.toLocaleString() ?? '0'}</div>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className={styles.filters}>
                <fieldset className={styles.filter_group}>
                    <legend className={styles.filter_label}>Severity Levels:</legend>
                    <div className={styles.checkbox_group} role="group" aria-label="Filter by severity level">
                        {(['error', 'warn', 'info', 'debug', 'trace'] as LogLevel[]).map(level => (
                            <label key={level} className={styles.checkbox_label}>
                                <input
                                    type="checkbox"
                                    checked={selectedLevels.includes(level)}
                                    onChange={() => handleToggleLevel(level)}
                                />
                                <span className={styles.checkbox_text}>{level.toUpperCase()}</span>
                            </label>
                        ))}
                    </div>
                </fieldset>

                <div className={styles.filter_group}>
                    <label className={styles.filter_label} htmlFor="service-filter">
                        Service Filter:
                    </label>
                    <select
                        id="service-filter"
                        className={styles.filter_input}
                        value={serviceFilter}
                        onChange={e => {
                            setServiceFilter(e.target.value);
                            setPage(1);
                            setInitialLoadState(true);
                            flashedLogsRef.current.clear();
                        }}
                    >
                        <option value="">All Services</option>
                        {stats?.byService && Object.keys(stats.byService).sort().map(service => (
                            <option key={service} value={service}>
                                {service} ({stats.byService[service].toLocaleString()})
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.filter_group}>
                    <label className={styles.filter_label} htmlFor="limit-filter">
                        Per Page:
                    </label>
                    <select
                        id="limit-filter"
                        className={styles.filter_select}
                        value={limit}
                        onChange={e => {
                            setLimit(Number(e.target.value));
                            setPage(1);
                            setInitialLoadState(true);
                            flashedLogsRef.current.clear();
                        }}
                    >
                        <option value="10">10</option>
                        <option value="25">25</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                    </select>
                </div>

                <div className={styles.filter_group}>
                    <label className={styles.filter_label} htmlFor="polling-filter">
                        Polling:
                    </label>
                    <select
                        id="polling-filter"
                        className={styles.filter_select}
                        value={pollingInterval}
                        onChange={e => setPollingInterval(Number(e.target.value))}
                    >
                        <option value="0">None</option>
                        <option value="1000">1s</option>
                        <option value="10000">10s</option>
                        <option value="30000">30s</option>
                        <option value="60000">60s</option>
                    </select>
                </div>

                <div className={styles.filter_group_right}>
                    <Button
                        variant="secondary"
                        size="sm"
                        icon={<Trash2 size={14} />}
                        onClick={handleClearLogs}
                    >
                        Clear All Logs
                    </Button>
                </div>
            </div>

            {/* Logs Table */}
            <div className={styles.table_container}>
                {logs.length === 0 ? (
                    <div className={styles.empty_state}>
                        No logs found matching the current filters.
                    </div>
                ) : (
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Level</th>
                                <th>Service</th>
                                <th>Message</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.map(log => (
                                <React.Fragment key={log._id}>
                                    <tr
                                        className={`${styles.log_row} ${newLogIds.has(log._id) ? styles.log_row_new : ''}`}
                                    >
                                        <td className={styles.timestamp}>{formatTimestamp(log.timestamp)}</td>
                                        <td>
                                            <span className={`${styles.level_badge} ${getLevelClass(log.level)}`}>
                                                {log.level.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className={styles.service}>{log.service}</td>
                                        <td className={styles.message}>{log.message}</td>
                                        <td className={styles.actions}>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                icon={expandedLogId === log._id
                                                    ? <ChevronUp size={14} />
                                                    : <ChevronDown size={14} />}
                                                aria-label={expandedLogId === log._id ? 'Hide log details' : 'Show log details'}
                                                onClick={() => setExpandedLogId(expandedLogId === log._id ? null : log._id)}
                                            >
                                                {expandedLogId === log._id ? 'Hide' : 'Details'}
                                            </Button>
                                        </td>
                                    </tr>
                                    {expandedLogId === log._id && (
                                        <tr className={styles.detail_row}>
                                            <td colSpan={5}>
                                                <div className={styles.detail_content}>
                                                    <div className={styles.detail_section}>
                                                        <strong>Context:</strong>
                                                        <pre className={styles.context_json}>
                                                            {JSON.stringify(log.context, null, 2)}
                                                        </pre>
                                                    </div>
                                                    {log.resolved && log.resolvedAt && (
                                                        <div className={styles.detail_section}>
                                                            <strong>Resolved:</strong> {formatTimestamp(log.resolvedAt)}
                                                            {log.resolvedBy && ` by ${log.resolvedBy}`}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <nav className={styles.pagination} aria-label="Log pagination">
                    <div className={styles.pagination_controls}>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setPage(1);
                                setInitialLoadState(true);
                                flashedLogsRef.current.clear();
                            }}
                            disabled={!hasPrevPage}
                        >
                            First
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setPage(p => p - 1);
                                setInitialLoadState(true);
                                flashedLogsRef.current.clear();
                            }}
                            disabled={!hasPrevPage}
                        >
                            Previous
                        </Button>
                        <div className={styles.pagination_info}>
                            Page {page} of {totalPages} ({total.toLocaleString()} total logs)
                        </div>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setPage(p => p + 1);
                                setInitialLoadState(true);
                                flashedLogsRef.current.clear();
                            }}
                            disabled={!hasNextPage}
                        >
                            Next
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setPage(totalPages);
                                setInitialLoadState(true);
                                flashedLogsRef.current.clear();
                            }}
                            disabled={!hasNextPage}
                        >
                            Last
                        </Button>
                    </div>
                </nav>
            )}
        </div>
    );
}
