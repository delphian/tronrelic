'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Layers, Play } from 'lucide-react';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { StatStrip } from './StatStrip';
import styles from './BlockchainSection.module.scss';

interface Props {
    token: string;
}

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

interface BlockProcessingMetrics {
    averageBlockProcessingTime: number | null;
    blocksPerMinute: number | null;
    successRate: number;
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

/**
 * Blockchain monitoring body — sync status, pipeline timings, observer table.
 *
 * One fetch cycle hits four endpoints in parallel; sub-blocks render as
 * tight StatStrip rows so all the data fits at desktop without forcing
 * a tile-per-metric vertical stack. The observer block stays as a
 * compact table because six numeric columns line up better than they
 * would as stat tiles.
 */
export function BlockchainSection({ token }: Props) {
    const [status, setStatus] = useState<BlockchainStatus | null>(null);
    const [metrics, setMetrics] = useState<BlockProcessingMetrics | null>(null);
    const [observers, setObservers] = useState<ObserverStats[]>([]);
    const [schedulerEnabled, setSchedulerEnabled] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);
    const runtimeConfig = getRuntimeConfig();

    const fetchData = useCallback(async () => {
        try {
            const [statusRes, metricsRes, observersRes, schedulerRes] = await Promise.all([
                fetch(`${runtimeConfig.apiUrl}/admin/system/blockchain/status`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiUrl}/admin/system/blockchain/metrics`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiUrl}/admin/system/blockchain/observers`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiUrl}/admin/system/scheduler/health`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            setStatus(statusRes.ok ? (await statusRes.json()).status ?? null : null);
            setMetrics(metricsRes.ok ? (await metricsRes.json()).metrics ?? null : null);
            setObservers(observersRes.ok ? (await observersRes.json()).observers ?? [] : []);
            setSchedulerEnabled(
                schedulerRes.ok ? (await schedulerRes.json()).health?.enabled ?? true : true
            );

            if (!statusRes.ok && !metricsRes.ok && !observersRes.ok) {
                throw new Error(
                    `Blockchain endpoints unavailable (status ${statusRes.status}, metrics ${metricsRes.status}, observers ${observersRes.status})`
                );
            }
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch blockchain data');
        }
    }, [token, runtimeConfig.apiUrl]);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const triggerSync = async () => {
        if (syncing) return;
        setSyncing(true);
        setError(null);
        try {
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/system/blockchain/sync`, {
                method: 'POST',
                headers: { 'X-Admin-Token': token }
            });
            let data: any = null;
            try {
                data = await response.json();
            } catch {
                data = null;
            }
            if (!response.ok) {
                throw new Error(
                    data?.error
                        ?? data?.message
                        ?? `Failed to trigger sync: ${response.statusText || response.status}`
                );
            }
            setTimeout(() => void fetchData(), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to trigger sync');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className={styles.subsection}>
            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={14} aria-hidden="true" />
                        {error}
                    </span>
                </div>
            )}

            <SyncStatusBlock
                status={status}
                metrics={metrics}
                schedulerEnabled={schedulerEnabled}
                syncing={syncing}
                onTriggerSync={() => void triggerSync()}
            />

            <PipelineMetricsBlock status={status} />

            <ObserverPerformanceBlock observers={observers} />
        </div>
    );
}

interface SyncStatusBlockProps {
    status: BlockchainStatus | null;
    metrics: BlockProcessingMetrics | null;
    schedulerEnabled: boolean;
    syncing: boolean;
    onTriggerSync: () => void;
}

function SyncStatusBlock({ status, metrics, schedulerEnabled, syncing, onTriggerSync }: SyncStatusBlockProps) {
    const netCatchUpRate = status?.netCatchUpRate ?? null;
    const fallingBehind = netCatchUpRate !== null && netCatchUpRate < 0 && !status?.lastTimings?.throttle;

    return (
        <div className={styles.block}>
            <header className={styles.block_header}>
                <h4 className={styles.block_title}>Sync Status</h4>
                <Button
                    variant="primary"
                    size="xs"
                    icon={<Play size={14} />}
                    onClick={onTriggerSync}
                    disabled={syncing || schedulerEnabled}
                    loading={syncing}
                    title={schedulerEnabled
                        ? 'Scheduler is running automatically every minute'
                        : 'Manually trigger blockchain sync'}
                >
                    Trigger Sync
                </Button>
            </header>

            {status?.lastError && (
                <Stack gap="sm">
                    <code className={styles.error_message}>
                        {formatErrorMessage(status.lastError)}
                    </code>
                    {getErrorTimestamp(status) && (
                        <span className={styles.error_timestamp}>
                            Last occurred:{' '}
                            <ClientTime
                                date={getErrorTimestamp(status) as string}
                                format="datetime"
                            />
                        </span>
                    )}
                </Stack>
            )}

            {status && (
                <StatStrip
                    items={[
                        {
                            label: 'Network Height',
                            value: status.networkBlock.toLocaleString(),
                            detail: 'Latest TRON block'
                        },
                        {
                            label: 'Local Block',
                            value: status.currentBlock.toLocaleString(),
                            detail: 'Last indexed locally'
                        },
                        {
                            label: 'Lag',
                            value: status.lag.toLocaleString(),
                            detail: status.averageProcessingDelaySeconds !== null
                                ? `${formatDuration(status.averageProcessingDelaySeconds)} behind`
                                : `${status.lag.toLocaleString()} blocks behind`,
                            tone: getLagMetricTone(status.lag, status.liveChainThrottleBlocks)
                        },
                        ...(status.processingBlocksPerMinute !== null
                            ? [{
                                label: 'Process Rate',
                                value: `${status.processingBlocksPerMinute.toFixed(1)} b/m`,
                                detail: 'Blocks per minute'
                            }]
                            : []),
                        ...(netCatchUpRate !== null
                            ? [{
                                label: 'Net Catch-up',
                                value: `${netCatchUpRate >= 0 ? '+' : ''}${netCatchUpRate.toFixed(1)} b/m`,
                                detail: status.estimatedCatchUpTime !== null && status.estimatedCatchUpTime > 0
                                    ? `ETA ${formatCatchUpEta(status.estimatedCatchUpTime)}`
                                    : 'Process − network',
                                tone: (netCatchUpRate < 0 ? 'warning' : 'success') as 'warning' | 'success'
                            }]
                            : []),
                        ...(metrics
                            ? [{
                                label: 'Success Rate',
                                value: `${metrics.successRate.toFixed(1)}%`,
                                detail: 'Last 180 blocks',
                                tone: getSuccessRateTone(metrics.successRate)
                            }]
                            : [])
                    ]}
                />
            )}

            {fallingBehind && netCatchUpRate !== null && (
                <div className="alert alert--warning" role="alert">
                    <span className={styles.error_inline}>
                        <AlertTriangle size={14} aria-hidden="true" />
                        Processing throughput slower than network ({netCatchUpRate.toFixed(1)} b/m). Lag may grow.
                    </span>
                </div>
            )}
        </div>
    );
}

interface PipelineMetricsBlockProps {
    status: BlockchainStatus | null;
}

function PipelineMetricsBlock({ status }: PipelineMetricsBlockProps) {
    if (!status) return null;

    if (!status.lastTimings) {
        return (
            <div className={styles.block}>
                <h4 className={styles.block_title}>Pipeline Metrics</h4>
                <p className={styles.block_note}>No timing data available yet.</p>
            </div>
        );
    }

    const blockNumber = status.lastProcessedBlockNumber ?? status.currentBlock;
    const totalMs = status.lastTimings.total ?? 0;

    return (
        <div className={styles.block}>
            <header className={styles.block_header}>
                <h4 className={styles.block_title}>Pipeline Metrics</h4>
                <span className={styles.block_note}>
                    Block {blockNumber.toLocaleString()} ({status.lastTransactionCount ?? 0} tx)
                </span>
            </header>

            <StatStrip
                items={[
                    {
                        label: 'Fetch Block',
                        value: `${(status.lastTimings.fetchBlock ?? 0).toFixed(0)} ms`,
                        detail: 'TronGrid round trip'
                    },
                    {
                        label: 'Process Tx',
                        value: `${(status.lastTimings.processTransactions ?? 0).toFixed(0)} ms`,
                        detail: 'Parse + notify'
                    },
                    {
                        label: 'Bulk Write',
                        value: `${(status.lastTimings.bulkWriteTransactions ?? 0).toFixed(0)} ms`,
                        detail: 'Persist to MongoDB'
                    },
                    ...(status.lastTimings.throttle !== undefined
                        ? [{
                            label: 'Throttle',
                            value: `${status.lastTimings.throttle.toFixed(0)} ms`,
                            detail: 'Pacing delay'
                        }]
                        : []),
                    {
                        label: 'Total',
                        value: `${totalMs.toFixed(0)} ms`,
                        detail: 'End-to-end',
                        tone: totalMs > 3000 ? ('danger' as const) : undefined
                    }
                ]}
            />
        </div>
    );
}

interface ObserverPerformanceBlockProps {
    observers: ObserverStats[];
}

function ObserverPerformanceBlock({ observers }: ObserverPerformanceBlockProps) {
    return (
        <div className={styles.block}>
            <header className={styles.block_header}>
                <h4 className={styles.block_title}>Observer Performance</h4>
                <span className={styles.block_note}>
                    Async transaction processors — high queue depth or processing time signals a bottleneck.
                </span>
            </header>

            {observers.length === 0 ? (
                <p className={styles.block_note}>
                    <Layers size={14} aria-hidden="true" /> No observers registered.
                </p>
            ) : (
                <Table variant="compact">
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
                                        <span className={styles.observer_meta}>
                                            Last:{' '}
                                            <ClientTime
                                                date={observer.lastProcessedAt}
                                                format="relative"
                                            />
                                        </span>
                                    )}
                                </Td>
                                <Td>
                                    <span className={styles.cell_inline}>
                                        <Badge tone={observer.avgProcessingTimeMs > 100 ? 'warning' : 'neutral'}>
                                            {`${observer.avgProcessingTimeMs.toFixed(1)} ms`}
                                        </Badge>
                                        <span className={styles.observer_meta}>
                                            {observer.minProcessingTimeMs}–{observer.maxProcessingTimeMs} ms
                                        </span>
                                    </span>
                                </Td>
                                <Td>
                                    <Badge tone={observer.queueDepth > 10 ? 'warning' : 'neutral'}>
                                        {observer.queueDepth}
                                    </Badge>
                                </Td>
                                <Td muted>{observer.totalProcessed.toLocaleString()}</Td>
                                <Td>
                                    <span className={styles.cell_inline}>
                                        {observer.totalErrors}
                                        {observer.totalDropped > 0 && (
                                            <Badge tone="danger">
                                                {observer.totalDropped} dropped
                                            </Badge>
                                        )}
                                    </span>
                                </Td>
                                <Td>
                                    <Badge tone={getErrorRateTone(observer.errorRate)}>
                                        {`${(observer.errorRate * 100).toFixed(2)}%`}
                                    </Badge>
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </div>
    );
}

function getLagMetricTone(lag: number, throttleThreshold: number): 'success' | 'warning' | 'danger' {
    if (lag < throttleThreshold) return 'success';
    if (lag >= 100) return 'danger';
    return 'warning';
}

function getSuccessRateTone(rate: number): 'success' | 'warning' | 'danger' {
    if (rate >= 99) return 'success';
    if (rate >= 95) return 'warning';
    return 'danger';
}

function getErrorRateTone(rate: number): 'success' | 'warning' | 'danger' {
    if (rate > 0.01) return 'danger';
    if (rate > 0) return 'warning';
    return 'success';
}

function formatDuration(seconds: number): string {
    const minutes = seconds / 60;
    const hours = minutes / 60;
    if (minutes > 300) return `${hours.toFixed(1)} hr`;
    if (seconds > 300) return `${minutes.toFixed(1)} min`;
    return `${seconds.toFixed(1)}s`;
}

function formatCatchUpEta(minutes: number): string {
    if (minutes > 300) return `${(minutes / 60).toFixed(1)} hr`;
    return `${minutes} min`;
}

function formatErrorMessage(error: string | BlockchainError): string {
    if (typeof error === 'string') return error;
    return `Block ${error.blockNumber}: ${error.message}`;
}

function getErrorTimestamp(status: BlockchainStatus): string | null {
    if (status.lastErrorAt) return status.lastErrorAt;
    if (status.lastError && typeof status.lastError === 'object') return status.lastError.at;
    return null;
}
