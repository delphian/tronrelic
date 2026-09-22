'use client';

import { useEffect, useState, useRef, useCallback, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type { ISystemLogsMonitorProps, LogLevel } from '@/types';
import { LOG_MONITOR_LEVELS_SETTING } from '@/types';
import { Button } from '../../../../components/ui/Button';
import { Select } from '../../../../components/ui/Select';
import { Badge } from '../../../../components/ui/Badge';
import { Pagination } from '../../../../components/ui/Pagination';
import { SlideOver } from '../../../../components/ui/SlideOver';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import { Stack } from '../../../../components/layout';
import { cn } from '../../../../lib/cn';
import { getSystemLogs, getLogStats, deleteAllLogs, getLogMonitorLevels, saveLogMonitorLevels } from '../../api';
import type { SystemLog, LogStats } from '../../types';
import { LogLevelFilter } from '../LogLevelFilter';
import { LogEntryDetail } from '../LogEntryDetail';
import { contextErrorText, levelLabel, levelTone, splitLogTimestamp } from '../../lib/logPresentation';
import styles from './SystemLogsMonitor.module.scss';

/** Auto-refresh choices, in milliseconds; 0 turns refreshing off. */
const REFRESH_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
    { value: 0, label: 'Off' },
    { value: 1000, label: 'Every 1s' },
    { value: 10000, label: 'Every 10s' },
    { value: 30000, label: 'Every 30s' },
    { value: 60000, label: 'Every 60s' }
];

/** Page sizes the footer offers. */
const PAGE_SIZES: readonly number[] = [10, 25, 50, 100];

/**
 * SystemLogsMonitor Component
 *
 * Admin diagnostic tool for reading the log entries the backend saved to
 * MongoDB, used full-page on `/system/logs` and as the Logs tab of every module
 * and plugin admin page.
 *
 * **Layout, top to bottom:**
 * - One toolbar: severity chips that are both the level filter and the level
 *   counts, then the service filter, auto-refresh, and "Clear all". The chip
 *   selection is remembered per operator in the user-settings store and
 *   shared by every instance of this component.
 * - A compact table, one line per entry, with the error text from the entry's
 *   context on a muted second line. Selecting a row opens the full record in a
 *   slide-over rather than expanding the row, so the list never jumps.
 * - A footer with the entry count, page controls, and page size.
 *
 * **Data Sources:**
 * - `/admin/system/logs` - Paginated logs with filtering
 * - `/admin/system/logs/stats` - Log statistics and service list
 *
 * **Security:**
 * Authorization rides the same-origin Better Auth session cookie;
 * the backend `requireAdmin` middleware resolves it per request.
 *
 * **Scoped mode:**
 * Plugins embed this component through `context.system` with `service` set,
 * for a Logs tab on their own admin page. The list and the level counts are
 * then filtered to that service on the server, the service selector and the
 * Service column are hidden because every row would repeat the same value,
 * and "Clear all" is removed, because it deletes every service's logs rather
 * than the scoped ones.
 *
 * @param props Optional `service` scope and `title` heading; both omitted on `/system/logs`.
 * @returns The log viewer.
 */
export function SystemLogsMonitor({ service, title }: ISystemLogsMonitorProps) {
    const [logs, setLogs] = useState<SystemLog[]>([]);
    const [stats, setStats] = useState<LogStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [limit, setLimit] = useState(10);
    const [total, setTotal] = useState(0);

    // Filters. The levels start at the shared default and are replaced by the
    // operator's saved preference once it loads; the first log fetch waits for
    // that so the list is not fetched twice.
    const [selectedLevels, setSelectedLevels] = useState<LogLevel[]>([...LOG_MONITOR_LEVELS_SETTING.defaultValue]);
    const [preferenceLoaded, setPreferenceLoaded] = useState(false);
    const levelsChangedByUserRef = useRef(false);
    const [serviceFilter, setServiceFilter] = useState('');

    // A fixed scope from the embedding page wins over the selector.
    const effectiveService = service ?? (serviceFilter.trim() || undefined);

    // Live polling (interval in milliseconds, 0 means disabled)
    const [pollingInterval, setPollingInterval] = useState(10000);

    // The entry open in the slide-over. Held as the entry itself rather than
    // its id, so an auto-refresh that pushes it off the current page does not
    // close the panel the operator is reading.
    const [selectedLog, setSelectedLog] = useState<SystemLog | null>(null);

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
     * Treats the next fetch as a fresh list after a filter, page, or page-size
     * change, so rows already on screen are not flashed as if they had just
     * arrived. Every control that changes which entries are shown calls this.
     *
     * @param nextPage - The page to show next; filter changes go back to the first page
     */
    const restartList = useCallback((nextPage: number) => {
        setPage(nextPage);
        setInitialLoadState(true);
        flashedLogsRef.current.clear();
    }, [setInitialLoadState]);

    /**
     * Fetches logs from the admin API with current filters and pagination.
     *
     * Uses the logs API client to construct and execute the query.
     * Updates component state with fresh data or logs errors on failure.
     */
    const fetchLogs = useCallback(async () => {
        try {
            const data = await getSystemLogs({
                levels: selectedLevels.length > 0 ? selectedLevels : undefined,
                service: effectiveService,
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
                setInitialLoadState(false);
            }
        } catch (error) {
            console.error('Failed to fetch logs:', error);
        } finally {
            setLoading(false);
        }
    }, [limit, page, selectedLevels, effectiveService, setInitialLoadState]);

    /**
     * Fetches log statistics from the admin API.
     *
     * Provides counts by severity level and service for dashboard metrics
     * and the service filter dropdown. In scoped mode the counts cover only
     * the scoped service.
     */
    const fetchStats = useCallback(async () => {
        try {
            const logStats = await getLogStats(service);
            setStats(logStats);

            // Reset service filter if the selected service no longer exists in stats
            setServiceFilter(prev => {
                if (prev && logStats.byService && !(prev in logStats.byService)) {
                    return '';
                }
                return prev;
            });
        } catch (error) {
            console.error('Failed to fetch log stats:', error);
        }
    }, [service]);

    /**
     * Executes the clear-all-logs API call and refreshes state.
     *
     * Called after the user confirms deletion via the confirmation modal.
     * Provides toast feedback on success or failure.
     */
    const executeClearLogs = useCallback(async () => {
        try {
            const deletedCount = await deleteAllLogs();
            push({ tone: 'success', title: `Deleted ${deletedCount.toLocaleString()} log entries` });
            setPage(1);
            await fetchLogs();
            await fetchStats();
        } catch {
            push({ tone: 'danger', title: 'Failed to clear logs', description: 'Please try again.' });
        }
    }, [push, fetchLogs, fetchStats]);

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
            title: 'Clear all logs',
            content: (
                <Stack gap="md">
                    <p>This deletes every saved log entry from every service, not only the ones shown. It cannot be undone.</p>
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
                            Delete all entries
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
     * Saves the operator's level selection so every Logs tab opens with it next time.
     *
     * Runs in the background after each toggle. A failed save leaves the
     * filter working for this page view, so the operator only gets a warning
     * toast telling them the choice will not be remembered.
     *
     * @param levels - The selection to remember
     */
    const persistLevels = useCallback(async (levels: LogLevel[]) => {
        try {
            await saveLogMonitorLevels(levels);
        } catch (error) {
            console.error('Failed to save log viewer levels:', error);
            push({ tone: 'warning', title: 'Filter not saved', description: 'Your severity selection will reset on the next visit.' });
        }
    }, [push]);

    /**
     * Toggles a severity level in the filter.
     *
     * Adds or removes the level from selectedLevels array, resets pagination,
     * and saves the new selection as the operator's preference. Clears flash
     * history so logs can flash again after filter changes.
     *
     * @param level - Log level to toggle
     */
    const handleToggleLevel = (level: LogLevel) => {
        const next = selectedLevels.includes(level)
            ? selectedLevels.filter(l => l !== level)
            : [...selectedLevels, level];
        levelsChangedByUserRef.current = true;
        setSelectedLevels(next);
        restartList(1);
        void persistLevels(next);
    };

    useEffect(() => {
        logsRef.current = logs;
    }, [logs]);

    useEffect(() => {
        isInitialLoadRef.current = isInitialLoad;
    }, [isInitialLoad]);

    // Load the operator's saved levels once, before the first log fetch
    useEffect(() => {
        let cancelled = false;

        /**
         * Applies the saved severity selection, if any, then releases the
         * first log fetch.
         *
         * A missing session or a failed read keeps the default levels, since
         * the viewer still works without the preference. A selection the
         * operator already made on this page wins over the saved one, so a
         * quick click before the read returns is not overwritten.
         */
        const loadPreference = async () => {
            try {
                const saved = await getLogMonitorLevels();
                if (!cancelled && saved && !levelsChangedByUserRef.current) {
                    setSelectedLevels(saved);
                }
            } catch (error) {
                console.error('Failed to load log viewer levels:', error);
            } finally {
                if (!cancelled) {
                    setPreferenceLoaded(true);
                }
            }
        };

        void loadPreference();

        return () => {
            cancelled = true;
        };
    }, []);

    // Initial fetch, once the saved levels are known
    useEffect(() => {
        if (!preferenceLoaded) return;
        void fetchLogs();
        void fetchStats();
    }, [fetchLogs, fetchStats, preferenceLoaded]);

    // Live polling interval
    useEffect(() => {
        if (pollingInterval === 0 || !preferenceLoaded) return;

        const interval = setInterval(() => {
            void fetchLogs();
            void fetchStats();
        }, pollingInterval);

        return () => clearInterval(interval);
    }, [fetchLogs, fetchStats, pollingInterval, preferenceLoaded]);

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

    /** Close the entry slide-over. */
    const closeEntry = useCallback(() => { setSelectedLog(null); }, []);

    const showServiceColumn = !service;
    const firstShown = total === 0 ? 0 : (page - 1) * limit + 1;
    const lastShown = Math.min(page * limit, total);

    // An empty list explains itself in terms of what the operator can change:
    // a narrow level filter, a chosen service, or genuinely nothing logged.
    let emptyText = 'Nothing has been logged yet.';
    if (selectedLevels.length > 0) {
        const levels = selectedLevels.map(level => levelLabel(level).toLowerCase()).join(', ');
        emptyText = `No ${levels} entries${effectiveService ? ` from ${effectiveService}` : ''}. Select more levels above to widen the list.`;
    } else if (effectiveService) {
        emptyText = `Nothing has been logged by ${effectiveService} yet.`;
    }

    let body: ReactNode;
    if (loading && logs.length === 0) {
        body = <p className={styles.placeholder}>Loading log entries…</p>;
    } else if (logs.length === 0) {
        body = <p className={styles.placeholder}>{emptyText}</p>;
    } else {
        body = (
            <div className={`table-scroll ${styles.table_wrap}`}>
                <Table>
                    <Thead>
                        <Tr>
                            <Th width="shrink">Time</Th>
                            <Th width="shrink">Level</Th>
                            {showServiceColumn && <Th width="shrink">Service</Th>}
                            <Th>Message</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {logs.map(log => {
                            const { date, time } = splitLogTimestamp(log.timestamp);
                            const errorText = contextErrorText(log);
                            return (
                                <Tr
                                    key={log._id}
                                    className={cn(styles.row, newLogIds.has(log._id) && 'table-row--flash')}
                                    onClick={() => setSelectedLog(log)}
                                >
                                    <Td data-label="Time" className={styles.col_time}>
                                        <span className={styles.time}>{time}</span>
                                        <span className={styles.date}>{date}</span>
                                    </Td>
                                    <Td data-label="Level">
                                        <Badge tone={levelTone(log.level)} size="xs">{levelLabel(log.level)}</Badge>
                                    </Td>
                                    {showServiceColumn && (
                                        <Td data-label="Service" className={styles.col_service}>{log.service}</Td>
                                    )}
                                    <Td data-label="Message">
                                        <div className={styles.entry}>
                                            {/* The button makes the row reachable by keyboard; the
                                                row's own click handler covers the pointer. It stops
                                                propagation so one click opens the entry once,
                                                matching the curation History table. */}
                                            <button
                                                type="button"
                                                className={styles.message}
                                                title={log.message}
                                                onClick={(event) => { event.stopPropagation(); setSelectedLog(log); }}
                                            >
                                                {log.message}
                                            </button>
                                            {errorText && <span className={styles.error_text}>{errorText}</span>}
                                        </div>
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Tbody>
                </Table>
            </div>
        );
    }

    return (
        <section className={styles.monitor} aria-label={title ?? 'System logs'}>
            {title && <h2 className={styles.title}>{title}</h2>}

            <div className={styles.toolbar}>
                <LogLevelFilter selected={selectedLevels} counts={stats?.byLevel} onToggle={handleToggleLevel} />

                <div className={styles.controls}>
                    {!service && (
                        <Select
                            size="sm"
                            aria-label="Service"
                            className={styles.service_select}
                            value={serviceFilter}
                            onChange={e => {
                                setServiceFilter(e.target.value);
                                restartList(1);
                            }}
                        >
                            <option value="">All services</option>
                            {stats?.byService && Object.keys(stats.byService).sort().map(name => (
                                <option key={name} value={name}>
                                    {name} ({stats.byService[name].toLocaleString()})
                                </option>
                            ))}
                        </Select>
                    )}

                    <div className={styles.refresh}>
                        {/* A steady dot while the list refreshes itself, so an
                            operator can tell a quiet log from a stopped one. */}
                        <span
                            className={cn(styles.refresh_dot, pollingInterval > 0 && styles.refresh_dot_on)}
                            aria-hidden="true"
                        />
                        <Select
                            size="sm"
                            aria-label="Auto-refresh"
                            value={pollingInterval}
                            onChange={e => setPollingInterval(Number(e.target.value))}
                        >
                            {REFRESH_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </div>

                    {!service && (
                        <Button variant="ghost" size="xs" icon={<Trash2 size={14} />} onClick={handleClearLogs}>
                            Clear all
                        </Button>
                    )}
                </div>
            </div>

            {body}

            {total > 0 && (
                <div className={styles.footer}>
                    <span className={styles.range}>
                        {firstShown.toLocaleString()}–{lastShown.toLocaleString()} of {total.toLocaleString()}
                    </span>
                    {total > limit && (
                        <Pagination
                            total={total}
                            pageSize={limit}
                            currentPage={page}
                            onPageChange={restartList}
                        />
                    )}
                    <Select
                        size="xs"
                        aria-label="Entries per page"
                        value={limit}
                        onChange={e => {
                            setLimit(Number(e.target.value));
                            restartList(1);
                        }}
                    >
                        {PAGE_SIZES.map(size => (
                            <option key={size} value={size}>{size} per page</option>
                        ))}
                    </Select>
                </div>
            )}

            <SlideOver
                open={selectedLog !== null}
                onClose={closeEntry}
                label={selectedLog ? `Log entry: ${selectedLog.message}` : undefined}
                title={selectedLog ? <span className={styles.entry_title}>{selectedLog.message}</span> : null}
            >
                {selectedLog && <LogEntryDetail log={selectedLog} />}
            </SlideOver>
        </section>
    );
}
