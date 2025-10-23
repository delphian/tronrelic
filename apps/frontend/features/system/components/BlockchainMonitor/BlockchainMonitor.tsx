'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { config as runtimeConfig } from '../../../../lib/config';
import styles from './BlockchainMonitor.module.css';

interface BlockchainError {
    at: string;
    blockNumber: number;
    message: string;
}

interface BlockchainStatus {
    currentBlock: number;
    networkBlock: number;
    lag: number;
    backfillQueueSize: number;
    lastProcessedAt: string | null;
    lastProcessedBlockId: string | null;
    lastProcessedBlockNumber: number | null;
    isHealthy: boolean;
    estimatedCatchUpTime: number | null;
    lastError: string | BlockchainError | null;
    lastErrorAt: string | null;
    processingBlocksPerMinute: number | null;
    networkBlocksPerMinute: number;
    netCatchUpRate: number | null;
    averageProcessingDelaySeconds: number | null;
    lastTimings: Record<string, number> | null;
    lastTransactionCount: number | null;
    liveChainThrottleBlocks: number;
}

interface TransactionStats {
    totalIndexed: number;
    indexedToday: number;
    byType: Record<string, number>;
}

interface BlockProcessingMetrics {
    averageBlockProcessingTime: number | null;
    blocksPerMinute: number | null;
    successRate: number;
    recentErrors: Array<{
        blockNumber: number;
        timestamp: string;
        message: string;
    }>;
    averageProcessingDelaySeconds: number | null;
    averageProcessingIntervalSeconds: number | null;
    networkBlocksPerMinute: number;
    netCatchUpRate: number | null;
    projectedCatchUpMinutes: number | null;
    backfillQueueSize: number;
}

interface ObserverStats {
    name: string;
    queueDepth: number;
    totalProcessed: number;
    totalErrors: number;
    totalDropped: number;
    avgProcessingTimeMs: number;
    minProcessingTimeMs: number;
    maxProcessingTimeMs: number;
    lastProcessedAt: string | null;
    lastErrorAt: string | null;
    errorRate: number;
}

interface Props {
    token: string;
}

/**
 * BlockchainMonitor Component
 *
 * Admin diagnostic tool for monitoring blockchain sync status and block processing performance.
 * Displays sync lag, processing rates, transaction indexing statistics, and error tracking.
 *
 * **Key Features:**
 * - Real-time blockchain sync status (current block, network block, lag)
 * - Processing rate tracking (b/m, catch-up rate, projected completion)
 * - Transaction indexing statistics (total, daily, by transaction type)
 * - Block processing performance metrics (delays, intervals, success rates)
 * - Error tracking and recent error history
 * - Manual sync trigger for forcing immediate synchronization
 * - Auto-refresh every 10 seconds for near-real-time monitoring
 * - Color-coded health indicators (green <10 blocks lag, yellow <100, red ≥100)
 *
 * **Data Sources:**
 * - `/admin/system/blockchain/status` - Sync status, lag, and processing rates
 * - `/admin/system/blockchain/transactions` - Transaction indexing statistics
 * - `/admin/system/blockchain/metrics` - Block processing performance metrics
 * - `/admin/system/blockchain/sync` - Manual sync trigger (POST)
 *
 * **Performance Warnings:**
 * - Displays alert when net catch-up rate is negative (falling behind network)
 * - Shows projected catch-up time based on current processing throughput
 * - Tracks backfill queue size for monitoring replay operations
 *
 * **Security:**
 * Requires admin token authentication via X-Admin-Token header.
 *
 * @param {Props} props - Component props
 * @param {string} props.token - Admin authentication token for API requests
 *
 * @example
 * ```tsx
 * <BlockchainMonitor token={adminToken} />
 * ```
 */
export function BlockchainMonitor({ token }: Props) {
    const [status, setStatus] = useState<BlockchainStatus | null>(null);
    const [stats, setStats] = useState<TransactionStats | null>(null);
    const [metrics, setMetrics] = useState<BlockProcessingMetrics | null>(null);
    const [observers, setObservers] = useState<ObserverStats[]>([]);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [schedulerEnabled, setSchedulerEnabled] = useState(true);
    const netCatchUpRate = status?.netCatchUpRate ?? null;

    /**
     * Fetches blockchain status, transaction stats, processing metrics, and scheduler health from admin API endpoints.
     *
     * Uses Promise.all for parallel fetching to minimize latency.
     * Updates component state with fresh data or logs errors on failure.
     */
    const fetchData = async () => {
        try {
            const [statusRes, statsRes, metricsRes, observersRes, schedulerRes] = await Promise.all([
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/blockchain/status`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/blockchain/transactions`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/blockchain/metrics`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/blockchain/observers`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/scheduler/health`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            // Parse each response independently with fallbacks to prevent one failure from breaking everything
            const statusData = await statusRes.json().catch(err => {
                console.error('Failed to parse blockchain status:', err);
                return { status: null };
            });
            const statsData = await statsRes.json().catch(err => {
                console.error('Failed to parse transaction stats:', err);
                return { stats: null };
            });
            const metricsData = await metricsRes.json().catch(err => {
                console.error('Failed to parse metrics:', err);
                return { metrics: null };
            });
            const observersData = await observersRes.json().catch(err => {
                console.error('Failed to parse observer stats:', err);
                return { observers: [] };
            });
            const schedulerData = await schedulerRes.json().catch(err => {
                console.error('Failed to parse scheduler health:', err);
                return { health: { enabled: true } };
            });

            setStatus(statusData.status);
            setStats(statsData.stats);
            setMetrics(metricsData.metrics);
            setObservers(observersData.observers || []);
            setSchedulerEnabled(schedulerData.health?.enabled ?? true);
        } catch (error) {
            console.error('Failed to fetch blockchain data:', error);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Triggers a manual blockchain synchronization.
     *
     * Forces immediate sync operation and disables button during operation.
     * Waits 2 seconds after triggering sync before fetching updated data
     * to allow backend time to complete the sync cycle.
     */
    const triggerSync = async () => {
        setSyncing(true);
        try {
            await fetch(`${runtimeConfig.apiBaseUrl}/admin/system/blockchain/sync`, {
                method: 'POST',
                headers: { 'X-Admin-Token': token }
            });
            // Refetch data after a moment
            setTimeout(fetchData, 2000);
        } catch (error) {
            console.error('Failed to trigger sync:', error);
        } finally {
            setSyncing(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    /**
     * Returns the appropriate CSS class variant for lag metric card based on severity.
     *
     * Maps lag values to color-coded variants for visual feedback:
     * - < liveChainThrottleBlocks: Green (healthy, within acceptable lag)
     * - ≥ liveChainThrottleBlocks but < 100: Yellow (warning, falling behind but manageable)
     * - ≥ 100 blocks: Red (danger, significant backlog)
     *
     * The liveChainThrottleBlocks threshold (default 20) represents the point where
     * the system considers itself "caught up" and applies intelligent throttling to
     * match TRON's 3-second block intervals.
     *
     * @param {number} lag - Number of blocks behind network
     * @param {number} throttleThreshold - Live chain throttle blocks from backend config
     * @returns {string} CSS Module class name for lag severity variant
     */
    const getLagClass = (lag: number, throttleThreshold: number): string => {
        if (lag < throttleThreshold) return styles['metric_card--healthy'];
        if (lag < 100) return styles['metric_card--warning'];
        return styles['metric_card--danger'];
    };

    /**
     * Formats error information for display, handling both string and object error types.
     *
     * Supports two error formats:
     * - String error: displayed directly
     * - Object error: formatted as "Block {blockNumber}: {message}"
     *
     * @param {string | BlockchainError} error - Error information
     * @returns {string} Formatted error message
     */
    const formatErrorMessage = (error: string | BlockchainError): string => {
        if (typeof error === 'string') {
            return error;
        }
        return `Block ${error.blockNumber}: ${error.message}`;
    };

    /**
     * Safely extracts and formats error timestamp from various error formats.
     *
     * Attempts to parse timestamp from multiple sources:
     * 1. status.lastErrorAt
     * 2. status.lastError.at (if object)
     *
     * Returns null if timestamp unavailable or parsing fails.
     *
     * @param {BlockchainStatus} status - Blockchain status containing error data
     * @returns {string | null} Formatted timestamp or null
     */
    const getErrorTimestamp = (status: BlockchainStatus): string | null => {
        try {
            if (status.lastErrorAt) {
                return new Date(status.lastErrorAt).toLocaleString();
            } else if (typeof status.lastError === 'object' && status.lastError.at) {
                return new Date(status.lastError.at).toLocaleString();
            }
        } catch (e) {
            // If date parsing fails, return the raw timestamp
            return status.lastErrorAt || (typeof status.lastError === 'object' ? status.lastError.at : null);
        }
        return null;
    };

    /**
     * Determines the health status CSS class for an observer based on performance metrics.
     *
     * Evaluates multiple metrics (processing time, queue depth, error rate) to determine
     * if the observer is healthy, warning, or in danger state.
     *
     * @param {ObserverStats} observer - Observer statistics
     * @returns {string} CSS Module class name for health status
     */
    const getObserverHealthClass = (observer: ObserverStats): string => {
        // Check processing time
        if (observer.avgProcessingTimeMs > 500) return styles['observer-row--danger'];
        if (observer.avgProcessingTimeMs > 100) return styles['observer-row--warning'];

        // Check queue depth
        if (observer.queueDepth > 100) return styles['observer-row--danger'];
        if (observer.queueDepth > 10) return styles['observer-row--warning'];

        // Check error rate (as percentage)
        const errorRatePercent = observer.errorRate * 100;
        if (errorRatePercent > 5) return styles['observer-row--danger'];
        if (errorRatePercent > 1) return styles['observer-row--warning'];

        return styles['observer-row--healthy'];
    };

    if (loading) {
        return <div className={styles.loading}>Loading blockchain monitoring data...</div>;
    }

    return (
        <div className={styles.container}>
            {/* Blockchain Sync Status */}
            <section className={styles.section}>
                <header className={styles.section__header}>
                    <h2 className={styles.section__title}>Blockchain Sync Status</h2>
                    <button
                        onClick={triggerSync}
                        disabled={syncing || schedulerEnabled}
                        className={styles.button}
                        title={schedulerEnabled ? 'Scheduler is running automatically every minute' : 'Manually trigger blockchain sync'}
                    >
                        {syncing ? 'Triggering...' : 'Trigger Sync Now'}
                    </button>
                </header>

                {status?.lastError && (
                    <div className={styles.error_alert}>
                        <div className={styles.error_alert__title}>⚠ Blockchain Sync Error</div>
                        <div className={styles.error_alert__message}>
                            {formatErrorMessage(status.lastError)}
                        </div>
                        {(() => {
                            const errorTime = getErrorTimestamp(status);
                            return errorTime ? (
                                <div className={styles.error_alert__timestamp}>
                                    Last occurred: {errorTime}
                                </div>
                            ) : null;
                        })()}
                    </div>
                )}

                {status && (
                    <div className={styles.metrics_grid}>
                        <div className={styles.metric_card}>
                            <div className={styles.metric_card__label}>
                                Network Height
                                <span className={styles.info_icon} title="The latest block number available on the TRON blockchain network">
                                    <Info size={14} />
                                </span>
                            </div>
                            <div className={styles.metric_card__value}>{status.networkBlock.toLocaleString()}</div>
                        </div>

                        <div className={styles.metric_card}>
                            <div className={styles.metric_card__label}>
                                Current Block
                                <span className={styles.info_icon} title="The last block number successfully processed and stored in the database">
                                    <Info size={14} />
                                </span>
                            </div>
                            <div className={styles.metric_card__value}>{status.currentBlock.toLocaleString()}</div>
                        </div>

                        <div className={`${styles.metric_card} ${getLagClass(status.lag, status.liveChainThrottleBlocks)}`}>
                            <div className={styles.metric_card__label}>
                                Lag (Blocks Behind)
                                <span className={styles.info_icon} title={`How many blocks behind the network we are. Green: <${status.liveChainThrottleBlocks}, Yellow: <100, Red: ≥100. Time behind shows average delay between block creation and processing.`}>
                                    <Info size={14} />
                                </span>
                            </div>
                            <div className={styles.metric_card__value}>
                                {status.lag.toLocaleString()}
                                {status.averageProcessingDelaySeconds !== null && (
                                    <span style={{ fontSize: '0.7em', opacity: 0.8, marginLeft: '0.5em' }}>
                                        ({(() => {
                                            const seconds = status.averageProcessingDelaySeconds;
                                            const minutes = seconds / 60;
                                            const hours = minutes / 60;

                                            if (minutes > 300) {
                                                return `${hours.toFixed(1)} hr`;
                                            } else if (seconds > 300) {
                                                return `${minutes.toFixed(1)} min`;
                                            } else {
                                                return `${seconds.toFixed(2)}s`;
                                            }
                                        })()})
                                    </span>
                                )}
                            </div>
                        </div>

                        {status.processingBlocksPerMinute !== null && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Processing Rate
                                    <span className={styles.info_icon} title="How many blocks per minute we're processing from the queue. The TRON network emits new blocks at ~20 blocks per minute (3-second interval)">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>
                                    {status.processingBlocksPerMinute.toFixed(1)} b/m
                                </div>
                            </div>
                        )}

                        {status.netCatchUpRate !== null && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Net Catch-up Rate
                                    <span className={styles.info_icon} title="Processing rate minus network rate. Positive means catching up, negative means falling behind. Est. catch-up time shows how long until all backlog blocks are processed.">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value} style={{ whiteSpace: 'nowrap' }}>
                                    {(status.netCatchUpRate >= 0 ? '+' : '-') + Math.abs(status.netCatchUpRate).toFixed(1)} b/m
                                    {status.estimatedCatchUpTime !== null && status.estimatedCatchUpTime > 0 && (
                                        <span style={{ fontSize: '0.7em', opacity: 0.8, marginLeft: '0.5em' }}>
                                            ({status.estimatedCatchUpTime > 300
                                                ? `${(status.estimatedCatchUpTime / 60).toFixed(1)} hr`
                                                : `${status.estimatedCatchUpTime} min`
                                            })
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {metrics && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Success Rate
                                    <span className={styles.info_icon} title="Percentage of blocks processed successfully without errors in the last 180 blocks">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>
                                    {metrics.successRate.toFixed(1)}%
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {netCatchUpRate !== null && netCatchUpRate <= 0 && !status?.lastTimings?.throttle && (
                    <div className={styles.warning_alert}>
                        Processing throughput is slower than the network ({netCatchUpRate.toFixed(1)} b/m).
                        Lag may continue to grow until throughput improves.
                    </div>
                )}
            </section>

            {/* Block Processing Pipeline Metrics */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Block Processing Pipeline Metrics</h2>
                {status?.lastTimings ? (
                    <>
                        <p className={styles.section__note}>
                            Timing metrics from block {(status.lastProcessedBlockNumber ?? status.currentBlock).toLocaleString()} ({status.lastTransactionCount ?? 0} transactions)
                        </p>

                        <div className={styles.metrics_grid}>
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Fetch Block (TronGrid)
                                    <span className={styles.info_icon} title="API call to TronGrid to retrieve the complete block data including all transactions, timestamps, and witness information">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.fetchBlock ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Get TRX Price
                                    <span className={styles.info_icon} title="Fetches the current TRX/USD exchange rate to calculate transaction values in dollars for display and analytics">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.getTrxPrice ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Process Transactions
                                    <span className={styles.info_icon} title="Parses all transactions in the block, extracts addresses and amounts, enriches with USD values, and builds relationship graphs between transactions">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.processTransactions ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    └─ Observer Notifications
                                    <span className={styles.info_icon} title="Notifies plugin observers of each transaction so they can react to specific patterns like whale transfers or delegation events">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.observerNotifications ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Bulk Write (MongoDB)
                                    <span className={styles.info_icon} title="Writes all processed transactions to the database in a single batch operation to minimize database round trips">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.bulkWriteTransactions ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Calculate Stats
                                    <span className={styles.info_icon} title="Aggregates block-level statistics like total transfers, contract calls, delegations, energy usage, and bandwidth consumption">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.calculateStats ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Update BlockModel
                                    <span className={styles.info_icon} title="Writes block metadata to the database including block ID, witness address, transaction count, and aggregated statistics">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.updateBlockModel ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Update SyncState
                                    <span className={styles.info_icon} title="Updates the sync cursor to mark this block as processed and removes it from the backfill queue if it was being retried">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.updateSyncState ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Socket Events
                                    <span className={styles.info_icon} title="Broadcasts real-time WebSocket events to connected frontend clients notifying them of the new block and its statistics">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.socketEvents ?? 0).toFixed(0)} ms</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>
                                    Alert Ingestion
                                    <span className={styles.info_icon} title="Processes transactions through the alert system to trigger notifications for whale transfers, interesting memos, and other notable events">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.alertIngestion ?? 0).toFixed(0)} ms</div>
                            </div>

                            {status.lastTimings.throttle !== undefined && (
                                <div className={`${styles.metric_card} ${styles['metric_card--throttle']}`}>
                                    <div className={styles.metric_card__label}>
                                        Throttle Delay
                                        <span className={styles.info_icon} title="Intelligent delay calculated to maintain consistent 3-second block intervals when caught up. Only adds remaining time needed after all processing completes, ensuring blocks emit at predictable intervals without unnecessary slowdown.">
                                            <Info size={14} />
                                        </span>
                                    </div>
                                    <div className={styles.metric_card__value}>{status.lastTimings.throttle.toFixed(0)} ms</div>
                                </div>
                            )}

                            <div className={`${styles.metric_card} ${(status.lastTimings.total ?? 0) > 3000 ? styles['metric_card--danger'] : ''}`}>
                                <div className={styles.metric_card__label}>
                                    Total Time
                                    <span className={styles.info_icon} title="Total elapsed time from the moment block processing started to when all pipeline stages completed">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_card__value}>{(status.lastTimings.total ?? 0).toFixed(0)} ms</div>
                            </div>
                        </div>
                    </>
                ) : (
                    <p className={styles.section__note}>
                        No timing data available yet. Timing metrics will appear after the next block is processed.
                    </p>
                )}
            </section>

            {/* Observer Performance */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Observer Performance</h2>
                {observers.length === 0 ? (
                    <p className={styles.section__note}>No observers registered</p>
                ) : (
                    <div className={styles.observer_table}>
                        <div className={styles.observer_table__header}>
                            <div className={styles.observer_table__cell}>Observer</div>
                            <div className={styles.observer_table__cell}>Avg Time</div>
                            <div className={styles.observer_table__cell}>Queue</div>
                            <div className={styles.observer_table__cell}>Processed</div>
                            <div className={styles.observer_table__cell}>Errors</div>
                            <div className={styles.observer_table__cell}>Error Rate</div>
                        </div>
                        {observers.map((observer) => (
                            <div
                                key={observer.name}
                                className={`${styles.observer_table__row} ${getObserverHealthClass(observer)}`}
                            >
                                <div className={styles.observer_table__cell}>
                                    <strong>{observer.name}</strong>
                                </div>
                                <div className={styles.observer_table__cell}>
                                    {observer.avgProcessingTimeMs.toFixed(1)}ms
                                    <span className={styles.observer_table__range}>
                                        ({observer.minProcessingTimeMs}-{observer.maxProcessingTimeMs}ms)
                                    </span>
                                </div>
                                <div className={styles.observer_table__cell}>
                                    {observer.queueDepth}
                                </div>
                                <div className={styles.observer_table__cell}>
                                    {observer.totalProcessed.toLocaleString()}
                                </div>
                                <div className={styles.observer_table__cell}>
                                    {observer.totalErrors}
                                    {observer.totalDropped > 0 && (
                                        <span className={styles.observer_table__dropped}>
                                            ({observer.totalDropped} dropped)
                                        </span>
                                    )}
                                </div>
                                <div className={styles.observer_table__cell}>
                                    {(observer.errorRate * 100).toFixed(2)}%
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <p className={styles.section__note}>
                    Observers process blockchain transactions asynchronously. High processing times or queue depths may indicate bottlenecks.
                </p>
            </section>
        </div>
    );
}
