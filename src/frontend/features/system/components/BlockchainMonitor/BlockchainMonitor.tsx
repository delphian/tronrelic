'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { config as runtimeConfig } from '../../../../lib/config';
import { Section, Grid, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ClientTime } from '../../../../components/ui/ClientTime';
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
     * Returns the appropriate Badge tone for lag metric based on severity.
     *
     * Maps lag values to color-coded tones for visual feedback:
     * - < liveChainThrottleBlocks: success (healthy, within acceptable lag)
     * - ≥ liveChainThrottleBlocks but < 100: warning (falling behind but manageable)
     * - ≥ 100 blocks: danger (significant backlog)
     *
     * @param {number} lag - Number of blocks behind network
     * @param {number} throttleThreshold - Live chain throttle blocks from backend config
     * @returns {'success' | 'warning' | 'danger'} Badge tone for lag severity
     */
    const getLagTone = (lag: number, throttleThreshold: number): 'success' | 'warning' | 'danger' => {
        if (lag < throttleThreshold) return 'success';
        if (lag < 100) return 'warning';
        return 'danger';
    };

    /**
     * Formats time duration for display in a human-readable format.
     *
     * @param {number} seconds - Duration in seconds
     * @returns {string} Formatted time string
     */
    const formatDuration = (seconds: number): string => {
        const minutes = seconds / 60;
        const hours = minutes / 60;
        if (minutes > 300) return `${hours.toFixed(1)} hr`;
        if (seconds > 300) return `${minutes.toFixed(1)} min`;
        return `${seconds.toFixed(1)}s`;
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
            } else if (status.lastError && typeof status.lastError === 'object' && status.lastError.at) {
                return new Date(status.lastError.at).toLocaleString();
            }
        } catch (e) {
            // If date parsing fails, return the raw timestamp
            return status.lastErrorAt || (status.lastError && typeof status.lastError === 'object' ? status.lastError.at : null);
        }
        return null;
    };

    if (loading) {
        return <div className={styles.loading}>Loading blockchain monitoring data...</div>;
    }

    return (
        <div className={styles.container}>
            {/* Blockchain Sync Status */}
            <Section>
                <Stack gap="md">
                    <div className={styles.section__header}>
                        <h2 className={styles.section__title}>Blockchain Sync Status</h2>
                        <button
                            onClick={triggerSync}
                            disabled={syncing || schedulerEnabled}
                            className={styles.button}
                            title={schedulerEnabled ? 'Scheduler is running automatically every minute' : 'Manually trigger blockchain sync'}
                        >
                            {syncing ? 'Triggering...' : 'Trigger Sync Now'}
                        </button>
                    </div>

                    {status && status.lastError && (
                        <Card tone="accent" padding="md" className={styles.error_card}>
                            <Stack gap="sm">
                                <strong className={styles.error_title}>⚠ Blockchain Sync Error</strong>
                                <code className={styles.error_message}>
                                    {formatErrorMessage(status.lastError)}
                                </code>
                                {(() => {
                                    const errorTime = getErrorTimestamp(status);
                                    return errorTime ? (
                                        <span className={styles.timestamp}>Last occurred: {errorTime}</span>
                                    ) : null;
                                })()}
                            </Stack>
                        </Card>
                    )}

                    {status && (
                        <Grid columns="responsive" gap="sm">
                            <Card padding="sm" tone="muted">
                                <div className={styles.metric_label}>
                                    Network Height
                                    <span className={styles.info_icon} title="The latest block number available on the TRON blockchain network">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_value}>{status.networkBlock.toLocaleString()}</div>
                            </Card>

                            <Card padding="sm" tone="muted">
                                <div className={styles.metric_label}>
                                    Current Block
                                    <span className={styles.info_icon} title="The last block number successfully processed and stored in the database">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_value}>{status.currentBlock.toLocaleString()}</div>
                            </Card>

                            <Card padding="sm" tone="muted">
                                <div className={styles.metric_label}>
                                    Lag (Blocks Behind)
                                    <span className={styles.info_icon} title={`How many blocks behind the network we are. Green: <${status.liveChainThrottleBlocks}, Yellow: <100, Red: ≥100.`}>
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_value}>
                                    <Badge tone={getLagTone(status.lag, status.liveChainThrottleBlocks)}>
                                        {status.lag.toLocaleString()}
                                    </Badge>
                                    {status.averageProcessingDelaySeconds !== null && (
                                        <span className={styles.metric_subtext}>
                                            ({formatDuration(status.averageProcessingDelaySeconds)} behind)
                                        </span>
                                    )}
                                </div>
                            </Card>

                            {status.processingBlocksPerMinute !== null && (
                                <Card padding="sm" tone="muted">
                                    <div className={styles.metric_label}>
                                        Processing Rate
                                        <span className={styles.info_icon} title="How many blocks per minute we're processing. TRON network emits ~20 blocks/min.">
                                            <Info size={14} />
                                        </span>
                                    </div>
                                    <div className={styles.metric_value}>
                                        {status.processingBlocksPerMinute.toFixed(1)} b/m
                                    </div>
                                </Card>
                            )}

                            {status.netCatchUpRate !== null && (
                                <Card padding="sm" tone={status.netCatchUpRate >= 0 ? 'muted' : 'accent'}>
                                    <div className={styles.metric_label}>
                                        Net Catch-up Rate
                                        <span className={styles.info_icon} title="Processing rate minus network rate. Positive = catching up, negative = falling behind.">
                                            <Info size={14} />
                                        </span>
                                    </div>
                                    <div className={styles.metric_value}>
                                        <Badge tone={status.netCatchUpRate >= 0 ? 'success' : 'danger'}>
                                            {(status.netCatchUpRate >= 0 ? '+' : '') + status.netCatchUpRate.toFixed(1)} b/m
                                        </Badge>
                                        {status.estimatedCatchUpTime !== null && status.estimatedCatchUpTime > 0 && (
                                            <span className={styles.metric_subtext}>
                                                (ETA: {status.estimatedCatchUpTime > 300
                                                    ? `${(status.estimatedCatchUpTime / 60).toFixed(1)} hr`
                                                    : `${status.estimatedCatchUpTime} min`
                                                })
                                            </span>
                                        )}
                                    </div>
                                </Card>
                            )}

                            {metrics && (
                                <Card padding="sm" tone="muted">
                                    <div className={styles.metric_label}>
                                        Success Rate
                                        <span className={styles.info_icon} title="Percentage of blocks processed successfully in the last 180 blocks">
                                            <Info size={14} />
                                        </span>
                                    </div>
                                    <div className={styles.metric_value}>
                                        <Badge tone={metrics.successRate >= 99 ? 'success' : metrics.successRate >= 95 ? 'warning' : 'danger'}>
                                            {metrics.successRate.toFixed(1)}%
                                        </Badge>
                                    </div>
                                </Card>
                            )}
                        </Grid>
                    )}

                    {netCatchUpRate !== null && netCatchUpRate <= 0 && !status?.lastTimings?.throttle && (
                        <Card tone="accent" padding="sm">
                            <span className={styles.warning_text}>
                                Processing throughput is slower than the network ({netCatchUpRate.toFixed(1)} b/m).
                                Lag may continue to grow until throughput improves.
                            </span>
                        </Card>
                    )}
                </Stack>
            </Section>

            {/* Block Processing Pipeline Metrics */}
            <Section>
                <h2 className={styles.section__title}>Block Processing Pipeline Metrics</h2>
                {status?.lastTimings ? (
                    <Stack gap="sm">
                        <p className={styles.section__note}>
                            Block {(status.lastProcessedBlockNumber ?? status.currentBlock).toLocaleString()} ({status.lastTransactionCount ?? 0} transactions)
                        </p>

                        <Grid columns="responsive" gap="sm">
                            <Card padding="sm" tone="muted">
                                <div className={styles.metric_label}>
                                    Fetch Block
                                    <span className={styles.info_icon} title="API call to TronGrid to retrieve block data">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_value}>{(status.lastTimings.fetchBlock ?? 0).toFixed(0)} ms</div>
                            </Card>

                            <Card padding="sm" tone="muted">
                                <div className={styles.metric_label}>
                                    Process Transactions
                                    <span className={styles.info_icon} title="Parse, enrich, and notify observers">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_value}>{(status.lastTimings.processTransactions ?? 0).toFixed(0)} ms</div>
                            </Card>

                            <Card padding="sm" tone="muted">
                                <div className={styles.metric_label}>
                                    Bulk Write
                                    <span className={styles.info_icon} title="Write transactions to MongoDB">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_value}>{(status.lastTimings.bulkWriteTransactions ?? 0).toFixed(0)} ms</div>
                            </Card>

                            {status.lastTimings.throttle !== undefined && (
                                <Card padding="sm" tone="accent">
                                    <div className={styles.metric_label}>
                                        Throttle
                                        <span className={styles.info_icon} title="Delay to maintain 3-second block intervals">
                                            <Info size={14} />
                                        </span>
                                    </div>
                                    <div className={styles.metric_value}>{status.lastTimings.throttle.toFixed(0)} ms</div>
                                </Card>
                            )}

                            <Card padding="sm" tone={(status.lastTimings.total ?? 0) > 3000 ? 'accent' : 'muted'}>
                                <div className={styles.metric_label}>
                                    Total Time
                                    <span className={styles.info_icon} title="Complete pipeline elapsed time">
                                        <Info size={14} />
                                    </span>
                                </div>
                                <div className={styles.metric_value}>{(status.lastTimings.total ?? 0).toFixed(0)} ms</div>
                            </Card>
                        </Grid>
                    </Stack>
                ) : (
                    <p className={styles.section__note}>
                        No timing data available yet.
                    </p>
                )}
            </Section>

            {/* Observer Performance */}
            <Section>
                <h2 className={styles.section__title}>Observer Performance</h2>
                {observers.length === 0 ? (
                    <p className={styles.section__note}>No observers registered</p>
                ) : (
                    <Table>
                        <Thead>
                            <Tr>
                                <Th>Observer</Th>
                                <Th>Avg Time</Th>
                                <Th>Queue</Th>
                                <Th>Processed</Th>
                                <Th>Errors</Th>
                                <Th>Error Rate</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {observers.map((observer) => (
                                <Tr key={observer.name} hasError={observer.errorRate > 0.05}>
                                    <Td>
                                        <strong>{observer.name}</strong>
                                        {observer.lastProcessedAt && (
                                            <span className={styles.last_processed}>
                                                Last: <ClientTime date={observer.lastProcessedAt} format="relative" />
                                            </span>
                                        )}
                                    </Td>
                                    <Td>
                                        <Badge tone={observer.avgProcessingTimeMs > 100 ? 'warning' : 'neutral'}>
                                            {observer.avgProcessingTimeMs.toFixed(1)}ms
                                        </Badge>
                                        <span className={styles.time_range}>
                                            ({observer.minProcessingTimeMs}-{observer.maxProcessingTimeMs}ms)
                                        </span>
                                    </Td>
                                    <Td>
                                        <Badge tone={observer.queueDepth > 10 ? 'warning' : 'neutral'}>
                                            {observer.queueDepth}
                                        </Badge>
                                    </Td>
                                    <Td>{observer.totalProcessed.toLocaleString()}</Td>
                                    <Td>
                                        {observer.totalErrors}
                                        {observer.totalDropped > 0 && (
                                            <Badge tone="danger" className={styles.dropped_badge}>
                                                {observer.totalDropped} dropped
                                            </Badge>
                                        )}
                                    </Td>
                                    <Td>
                                        <Badge tone={observer.errorRate > 0.01 ? 'danger' : observer.errorRate > 0 ? 'warning' : 'success'}>
                                            {(observer.errorRate * 100).toFixed(2)}%
                                        </Badge>
                                    </Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                )}
                <p className={styles.section__note}>
                    Observers process transactions asynchronously. High processing times or queue depths may indicate bottlenecks.
                </p>
            </Section>
        </div>
    );
}
