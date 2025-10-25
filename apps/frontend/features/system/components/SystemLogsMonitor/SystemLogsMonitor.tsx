'use client';

import React, { useEffect, useState, useRef } from 'react';
import type { LogLevel } from '@tronrelic/types';
import { config as runtimeConfig } from '../../../../lib/config';
import { Button } from '../../../../components/ui/Button';
import styles from './SystemLogsMonitor.module.css';

interface SystemLog {
    _id: string;
    timestamp: string;
    level: LogLevel;
    message: string;
    service: string;
    context: Record<string, any>;
    resolved: boolean;
    resolvedAt?: string;
    resolvedBy?: string;
}

interface LogsResponse {
    success: boolean;
    logs: SystemLog[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
}

interface LogStats {
    total: number;
    byLevel: Record<LogLevel, number>;
    resolved: number;
    unresolved: number;
}

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
 * - Service/plugin filtering
 * - Configurable live polling (None, 10s, 30s, 60s)
 * - Pagination with configurable page size
 * - Clear all logs functionality
 * - Expandable log details with context
 *
 * **Data Sources:**
 * - `/admin/system/logs` - Paginated logs with filtering
 * - `/admin/system/logs/stats` - Log statistics
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
    const [selectedLevels, setSelectedLevels] = useState<LogLevel[]>(['error', 'warn']);
    const [serviceFilter, setServiceFilter] = useState('');

    // Live polling (interval in milliseconds, 0 means disabled)
    const [pollingInterval, setPollingInterval] = useState(10000);

    // Expandable log details
    const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

    // Track new logs for flash animation
    const [newLogIds, setNewLogIds] = useState<Set<string>>(new Set());
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const flashedLogsRef = useRef<Set<string>>(new Set()); // Track logs that have already been flashed
    const flashTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const pendingFlashIdsRef = useRef<Set<string> | null>(null); // IDs waiting to flash on next render

    /**
     * Fetches logs from the admin API with current filters and pagination.
     *
     * Constructs query parameters based on selected filters and page state.
     * Updates component state with fresh data or logs errors on failure.
     */
    const fetchLogs = async () => {
        try {
            const params = new URLSearchParams();

            if (selectedLevels.length > 0) {
                selectedLevels.forEach(level => params.append('levels', level));
            }

            if (serviceFilter.trim()) {
                params.append('service', serviceFilter.trim());
            }

            params.append('page', page.toString());
            params.append('limit', limit.toString());

            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/system/logs?${params.toString()}`,
                {
                    headers: { 'X-Admin-Token': token }
                }
            );

            const data: LogsResponse = await response.json();

            if (data.success) {
                // Detect new logs if not initial load and we have existing logs
                if (!isInitialLoad && logs.length > 0) {
                    const currentIds = new Set(logs.map(log => log._id));
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
                setTotal(data.total);
                setTotalPages(data.totalPages);
                setHasNextPage(data.hasNextPage);
                setHasPrevPage(data.hasPrevPage);
                setIsInitialLoad(false);
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Fetches log statistics from the admin API.
     *
     * Provides counts by severity level and resolved status for dashboard metrics.
     */
    const fetchStats = async () => {
        try {
            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/system/logs/stats`,
                {
                    headers: { 'X-Admin-Token': token }
                }
            );

            const data = await response.json();

            if (data.success) {
                setStats(data.stats);
            }
        } catch (error) {
            console.error('Failed to fetch log stats:', error);
        }
    };

    /**
     * Clears all logs after user confirmation.
     *
     * Displays a confirmation dialog and sends DELETE request to admin API.
     * Refreshes logs and stats after successful deletion.
     */
    const handleClearLogs = async () => {
        if (!confirm('Are you sure you want to delete all logs? This action cannot be undone.')) {
            return;
        }

        try {
            const response = await fetch(
                `${runtimeConfig.apiBaseUrl}/admin/system/logs`,
                {
                    method: 'DELETE',
                    headers: { 'X-Admin-Token': token }
                }
            );

            const data = await response.json();

            if (data.success) {
                alert(`Deleted ${data.deletedCount} log entries`);
                setPage(1);
                await fetchLogs();
                await fetchStats();
            }
        } catch (error) {
            console.error('Failed to clear logs:', error);
            alert('Failed to clear logs. Please try again.');
        }
    };


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
        setIsInitialLoad(true); // Treat filter changes as initial load to prevent flash
        flashedLogsRef.current.clear(); // Clear flash history when filters change
    };

    // Initial fetch
    useEffect(() => {
        fetchLogs();
        fetchStats();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token, page, limit, selectedLevels, serviceFilter]);

    // Live polling interval
    useEffect(() => {
        if (pollingInterval === 0) return;

        const interval = setInterval(() => {
            fetchLogs();
            fetchStats();
        }, pollingInterval);

        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pollingInterval, token, page, limit, selectedLevels, serviceFilter]);

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
                    }, 1000);
                }
            });
        }
    }, [logs]); // Run whenever logs change

    // Cleanup flash timeout on unmount
    useEffect(() => {
        return () => {
            if (flashTimeoutRef.current) {
                clearTimeout(flashTimeoutRef.current);
            }
        };
    }, []);

    /**
     * Formats timestamp to localized date/time string.
     *
     * @param timestamp - ISO 8601 timestamp string
     * @returns Formatted date/time string
     */
    const formatTimestamp = (timestamp: string) => {
        return new Date(timestamp).toLocaleString();
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
                <div className={styles.filter_group}>
                    <label className={styles.filter_label}>Severity Levels:</label>
                    <div className={styles.checkbox_group}>
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
                </div>

                <div className={styles.filter_group}>
                    <label className={styles.filter_label} htmlFor="service-filter">
                        Service Filter:
                    </label>
                    <input
                        id="service-filter"
                        type="text"
                        className={styles.filter_input}
                        placeholder="Filter by service/plugin name"
                        value={serviceFilter}
                        onChange={e => {
                            setServiceFilter(e.target.value);
                            setPage(1);
                            setIsInitialLoad(true); // Treat filter changes as initial load
                            flashedLogsRef.current.clear(); // Clear flash history when filter changes
                        }}
                    />
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
                            setIsInitialLoad(true); // Treat limit changes as initial load
                            flashedLogsRef.current.clear(); // Clear flash history when page size changes
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
                    <Button variant="secondary" size="sm" onClick={handleClearLogs}>
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
                <div className={styles.pagination}>
                    <div className={styles.pagination_controls}>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setPage(1);
                                setIsInitialLoad(true); // Treat page changes as initial load
                                flashedLogsRef.current.clear(); // Clear flash history when changing pages
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
                                setIsInitialLoad(true); // Treat page changes as initial load
                                flashedLogsRef.current.clear(); // Clear flash history when changing pages
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
                                setIsInitialLoad(true); // Treat page changes as initial load
                                flashedLogsRef.current.clear(); // Clear flash history when changing pages
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
                                setIsInitialLoad(true); // Treat page changes as initial load
                                flashedLogsRef.current.clear(); // Clear flash history when changing pages
                            }}
                            disabled={!hasNextPage}
                        >
                            Last
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
