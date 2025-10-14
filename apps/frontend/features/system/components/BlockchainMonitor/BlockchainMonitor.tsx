'use client';

import { useEffect, useState } from 'react';
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
    isHealthy: boolean;
    estimatedCatchUpTime: number | null;
    lastError: string | BlockchainError | null;
    lastErrorAt: string | null;
    processingBlocksPerMinute: number | null;
    networkBlocksPerMinute: number;
    netCatchUpRate: number | null;
    averageProcessingDelaySeconds: number | null;
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
 * - Processing rate tracking (blocks/min, catch-up rate, projected completion)
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
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const netCatchUpRate = status?.netCatchUpRate ?? null;

    /**
     * Fetches blockchain status, transaction stats, and processing metrics from admin API endpoints.
     *
     * Uses Promise.all for parallel fetching to minimize latency.
     * Updates component state with fresh data or logs errors on failure.
     */
    const fetchData = async () => {
        try {
            const [statusRes, statsRes, metricsRes] = await Promise.all([
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/blockchain/status`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/blockchain/transactions`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/blockchain/metrics`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            const [statusData, statsData, metricsData] = await Promise.all([
                statusRes.json(),
                statsRes.json(),
                metricsRes.json()
            ]);

            setStatus(statusData.status);
            setStats(statsData.stats);
            setMetrics(metricsData.metrics);
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
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    /**
     * Returns the appropriate CSS class variant for lag metric card based on severity.
     *
     * Maps lag values to color-coded variants for visual feedback:
     * - <10 blocks: Green (healthy)
     * - 10-99 blocks: Yellow (warning)
     * - ≥100 blocks: Red (danger)
     *
     * @param {number} lag - Number of blocks behind network
     * @returns {string} CSS Module class name for lag severity variant
     */
    const getLagClass = (lag: number): string => {
        if (lag < 10) return styles['metric-card--healthy'];
        if (lag < 100) return styles['metric-card--warning'];
        return styles['metric-card--danger'];
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
                        disabled={syncing}
                        className={styles.button}
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
                            <div className={styles.metric_card__label}>Current Block</div>
                            <div className={styles.metric_card__value}>{status.currentBlock.toLocaleString()}</div>
                        </div>

                        <div className={styles.metric_card}>
                            <div className={styles.metric_card__label}>Network Block</div>
                            <div className={styles.metric_card__value}>{status.networkBlock.toLocaleString()}</div>
                        </div>

                        <div className={`${styles.metric_card} ${getLagClass(status.lag)}`}>
                            <div className={styles.metric_card__label}>Lag (Blocks Behind)</div>
                            <div className={styles.metric_card__value}>{status.lag.toLocaleString()}</div>
                        </div>

                        <div className={styles.metric_card}>
                            <div className={styles.metric_card__label}>Backfill Queue</div>
                            <div className={styles.metric_card__value}>{status.backfillQueueSize.toLocaleString()}</div>
                        </div>

                        {status.processingBlocksPerMinute !== null && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Processing Rate</div>
                                <div className={styles.metric_card__value}>
                                    {status.processingBlocksPerMinute.toFixed(1)} blocks/min
                                </div>
                            </div>
                        )}

                        <div className={styles.metric_card}>
                            <div className={styles.metric_card__label}>Network Rate</div>
                            <div className={styles.metric_card__value}>
                                {status.networkBlocksPerMinute.toFixed(1)} blocks/min
                            </div>
                        </div>

                        {status.netCatchUpRate !== null && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Net Catch-up Rate</div>
                                <div className={styles.metric_card__value}>
                                    {(status.netCatchUpRate >= 0 ? '+' : '-') + Math.abs(status.netCatchUpRate).toFixed(1)} blocks/min
                                </div>
                            </div>
                        )}

                        {status.averageProcessingDelaySeconds !== null && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Avg Processing Delay</div>
                                <div className={styles.metric_card__value}>
                                    {status.averageProcessingDelaySeconds.toFixed(2)}s
                                </div>
                            </div>
                        )}

                        {status.estimatedCatchUpTime !== null && status.estimatedCatchUpTime > 0 && (
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Est. Catch-up Time</div>
                                <div className={styles.metric_card__value}>
                                    {status.estimatedCatchUpTime} min
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {status?.lastProcessedAt && (
                    <div className={styles.timestamp}>
                        Last processed: {new Date(status.lastProcessedAt).toLocaleString()}
                    </div>
                )}

                {netCatchUpRate !== null && netCatchUpRate <= 0 && (
                    <div className={styles.warning_alert}>
                        Processing throughput is slower than the network ({netCatchUpRate.toFixed(1)} blocks/min).
                        Backfill may continue to grow until throughput improves.
                    </div>
                )}
            </section>

            {/* Transaction Statistics */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Transaction Indexing Statistics</h2>
                {stats && (
                    <>
                        <div className={styles.metrics_grid}>
                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Total Indexed</div>
                                <div className={styles.metric_card__value}>{stats.totalIndexed.toLocaleString()}</div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Indexed Today</div>
                                <div className={styles.metric_card__value}>{stats.indexedToday.toLocaleString()}</div>
                            </div>
                        </div>

                        <p className={styles.section__note}>
                            Whale alerts are now emitted by the whale alerts plugin, so this panel focuses on core indexing metrics.
                        </p>

                        {Object.keys(stats.byType).length > 0 && (
                            <div>
                                <h3 className={styles.section__subtitle}>By Transaction Type</h3>
                                <div className={styles.type_grid}>
                                    {Object.entries(stats.byType).map(([type, count]) => (
                                        <div key={type} className={styles.type_item}>
                                            <span className={styles.type_item__label}>{type}</span>
                                            <span className={styles.type_item__value}>{count.toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </section>

            {/* Block Processing Metrics */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Block Processing Performance</h2>
                {metrics && (
                    <>
                        <div className={styles.metrics_grid}>
                            {metrics.averageProcessingDelaySeconds !== null && (
                                <div className={styles.metric_card}>
                                    <div className={styles.metric_card__label}>Avg Processing Delay</div>
                                    <div className={styles.metric_card__value}>
                                        {metrics.averageProcessingDelaySeconds.toFixed(2)}s
                                    </div>
                                </div>
                            )}

                            {metrics.averageProcessingIntervalSeconds !== null && (
                                <div className={styles.metric_card}>
                                    <div className={styles.metric_card__label}>Avg Processing Interval</div>
                                    <div className={styles.metric_card__value}>
                                        {metrics.averageProcessingIntervalSeconds.toFixed(2)}s
                                    </div>
                                </div>
                            )}

                            {metrics.blocksPerMinute !== null && (
                                <div className={styles.metric_card}>
                                    <div className={styles.metric_card__label}>Processing Throughput</div>
                                    <div className={styles.metric_card__value}>
                                        {metrics.blocksPerMinute.toFixed(1)} blocks/min
                                    </div>
                                </div>
                            )}

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Network Throughput</div>
                                <div className={styles.metric_card__value}>
                                    {metrics.networkBlocksPerMinute.toFixed(1)} blocks/min
                                </div>
                            </div>

                            {metrics.netCatchUpRate !== null && (
                                <div className={styles.metric_card}>
                                    <div className={styles.metric_card__label}>Net Catch-up Rate</div>
                                    <div className={styles.metric_card__value}>
                                        {(metrics.netCatchUpRate >= 0 ? '+' : '-') + Math.abs(metrics.netCatchUpRate).toFixed(1)} blocks/min
                                    </div>
                                </div>
                            )}

                            {metrics.projectedCatchUpMinutes !== null && (
                                <div className={styles.metric_card}>
                                    <div className={styles.metric_card__label}>Projected Catch-up</div>
                                    <div className={styles.metric_card__value}>
                                        {metrics.projectedCatchUpMinutes} min
                                    </div>
                                </div>
                            )}

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Success Rate</div>
                                <div className={styles.metric_card__value}>
                                    {metrics.successRate.toFixed(1)}%
                                </div>
                            </div>

                            <div className={styles.metric_card}>
                                <div className={styles.metric_card__label}>Backfill Queue</div>
                                <div className={styles.metric_card__value}>
                                    {metrics.backfillQueueSize.toLocaleString()}
                                </div>
                            </div>
                        </div>

                        {metrics.recentErrors.length > 0 && (
                            <div>
                                <h3 className={styles.section__subtitle} style={{ color: '#ef4444' }}>
                                    Recent Errors
                                </h3>
                                <div className={styles.error_list}>
                                    {metrics.recentErrors.map((error, idx) => (
                                        <div key={idx} className={styles.error_item}>
                                            <div className={styles.error_item__block}>
                                                Block {error.blockNumber}
                                            </div>
                                            <div className={styles.error_item__timestamp}>
                                                {new Date(error.timestamp).toLocaleString()}
                                            </div>
                                            <div className={styles.error_item__message}>
                                                {error.message}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </section>
        </div>
    );
}
