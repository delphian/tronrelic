'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    Activity,
    AlertCircle,
    AlertTriangle,
    Blocks,
    CheckCircle,
    Clock,
    Database,
    Gauge,
    Layers,
    Network,
    Play,
    Timer,
    TrendingDown,
    Zap
} from 'lucide-react';
import { Stack, Grid } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { HealthMetric } from './HealthMetric';
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
 * Blockchain monitoring body — sync status, pipeline timings, and observer performance.
 *
 * Rendered inside a CollapsibleSection; the polling interval and API
 * fetches do not start until the admin expands the section. All three
 * sub-blocks share a single fetch cycle so opening the section costs
 * one round-trip instead of three.
 *
 * Auth follows the canonical admin pattern from docs/system/system-api.md:
 * X-Admin-Token header against ${runtimeConfig.apiUrl}/admin/...
 * URLs. Token presence is guaranteed by SystemAuthGate higher in the tree.
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

            // Each backend returns its own status independently; surface a
            // failure (and clear stale data) per-backend so a transient
            // outage on one endpoint doesn't keep showing healthy values.
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
            // Best-effort JSON parse so structured backend error details
            // survive non-2xx responses; fetch() only rejects on network errors.
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
            // Give the backend a moment to complete the sync cycle before
            // fetching fresh state, otherwise the next poll would still
            // show pre-trigger values.
            setTimeout(() => void fetchData(), 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to trigger sync');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <Stack gap="lg">
            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={16} aria-hidden="true" />
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
        </Stack>
    );
}

interface SyncStatusBlockProps {
    status: BlockchainStatus | null;
    metrics: BlockProcessingMetrics | null;
    schedulerEnabled: boolean;
    syncing: boolean;
    onTriggerSync: () => void;
}

/**
 * Top sync-state block: lag, throughput, success rate, and the manual sync trigger.
 *
 * The trigger button stays disabled while the scheduler job is running automatically;
 * exposing it during normal operation would let an operator stack a manual run on top
 * of an in-flight scheduled run, doubling write pressure for no benefit.
 */
function SyncStatusBlock({ status, metrics, schedulerEnabled, syncing, onTriggerSync }: SyncStatusBlockProps) {
    const netCatchUpRate = status?.netCatchUpRate ?? null;
    const fallingBehind = netCatchUpRate !== null && netCatchUpRate < 0 && !status?.lastTimings?.throttle;

    return (
        <section className={styles.subsection}>
            <header className={styles.subsection_header}>
                <h3 className={styles.subsection_title}>Sync Status</h3>
                <Button
                    variant="primary"
                    size="sm"
                    icon={<Play size={16} />}
                    onClick={onTriggerSync}
                    disabled={syncing || schedulerEnabled}
                    loading={syncing}
                    title={schedulerEnabled
                        ? 'Scheduler is running automatically every minute'
                        : 'Manually trigger blockchain sync'}
                >
                    Trigger Sync Now
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
                <Grid columns="responsive" gap="sm">
                    <HealthMetric
                        icon={<Network size={20} />}
                        label="Network Height"
                        value={status.networkBlock.toLocaleString()}
                        detail="Latest TRON block"
                    />
                    <HealthMetric
                        icon={<Blocks size={20} />}
                        label="Current Block"
                        value={status.currentBlock.toLocaleString()}
                        detail="Last indexed locally"
                    />
                    <HealthMetric
                        icon={<TrendingDown size={20} />}
                        label="Lag"
                        value={
                            <span className={styles.cell_inline}>
                                <Badge tone={getLagTone(status.lag, status.liveChainThrottleBlocks)}>
                                    {status.lag.toLocaleString()}
                                </Badge>
                            </span>
                        }
                        detail={status.averageProcessingDelaySeconds !== null
                            ? `${formatDuration(status.averageProcessingDelaySeconds)} behind`
                            : `${status.lag.toLocaleString()} blocks behind`}
                        tone={getLagMetricTone(status.lag, status.liveChainThrottleBlocks)}
                    />
                    {status.processingBlocksPerMinute !== null && (
                        <HealthMetric
                            icon={<Activity size={20} />}
                            label="Processing Rate"
                            value={`${status.processingBlocksPerMinute.toFixed(1)} b/m`}
                            detail="Blocks per minute"
                        />
                    )}
                    {netCatchUpRate !== null && (
                        <HealthMetric
                            icon={<Gauge size={20} />}
                            label="Net Catch-up Rate"
                            value={
                                <span className={styles.cell_inline}>
                                    <Badge tone={netCatchUpRate >= 0 ? 'success' : 'danger'}>
                                        {`${netCatchUpRate >= 0 ? '+' : ''}${netCatchUpRate.toFixed(1)} b/m`}
                                    </Badge>
                                </span>
                            }
                            detail={status.estimatedCatchUpTime !== null && status.estimatedCatchUpTime > 0
                                ? `ETA: ${formatCatchUpEta(status.estimatedCatchUpTime)}`
                                : 'Processing − network rate'}
                            tone={netCatchUpRate < 0 ? 'danger' : 'neutral'}
                        />
                    )}
                    {metrics && (
                        <HealthMetric
                            icon={<CheckCircle size={20} />}
                            label="Success Rate"
                            value={
                                <span className={styles.cell_inline}>
                                    <Badge tone={getSuccessRateTone(metrics.successRate)}>
                                        {`${metrics.successRate.toFixed(1)}%`}
                                    </Badge>
                                </span>
                            }
                            detail="Last 180 blocks"
                        />
                    )}
                </Grid>
            )}

            {fallingBehind && netCatchUpRate !== null && (
                <div className="alert alert--warning" role="alert">
                    <span className={styles.error_inline}>
                        <AlertTriangle size={16} aria-hidden="true" />
                        Processing throughput is slower than the network ({netCatchUpRate.toFixed(1)} b/m).
                        Lag may continue to grow until throughput improves.
                    </span>
                </div>
            )}
        </section>
    );
}

interface PipelineMetricsBlockProps {
    status: BlockchainStatus | null;
}

/**
 * Per-block pipeline timing breakdown: fetch, process, write, throttle.
 *
 * Exposes which pipeline stage is slow so operators can attribute lag to a
 * specific cause (TronGrid latency vs Mongo write latency vs intentional throttle)
 * instead of guessing.
 */
function PipelineMetricsBlock({ status }: PipelineMetricsBlockProps) {
    if (!status) return null;

    if (!status.lastTimings) {
        return (
            <section className={styles.subsection}>
                <header className={styles.subsection_header}>
                    <h3 className={styles.subsection_title}>Pipeline Metrics</h3>
                </header>
                <p className={styles.subsection_note}>No timing data available yet.</p>
            </section>
        );
    }

    const blockNumber = status.lastProcessedBlockNumber ?? status.currentBlock;
    const totalMs = status.lastTimings.total ?? 0;

    return (
        <section className={styles.subsection}>
            <header className={styles.subsection_header}>
                <h3 className={styles.subsection_title}>Pipeline Metrics</h3>
                <span className={styles.subsection_note}>
                    Block {blockNumber.toLocaleString()} ({status.lastTransactionCount ?? 0} transactions)
                </span>
            </header>

            <Grid columns="responsive" gap="sm">
                <HealthMetric
                    icon={<Network size={20} />}
                    label="Fetch Block"
                    value={`${(status.lastTimings.fetchBlock ?? 0).toFixed(0)} ms`}
                    detail="TronGrid round trip"
                />
                <HealthMetric
                    icon={<Zap size={20} />}
                    label="Process Transactions"
                    value={`${(status.lastTimings.processTransactions ?? 0).toFixed(0)} ms`}
                    detail="Parse, enrich, notify observers"
                />
                <HealthMetric
                    icon={<Database size={20} />}
                    label="Bulk Write"
                    value={`${(status.lastTimings.bulkWriteTransactions ?? 0).toFixed(0)} ms`}
                    detail="Persist to MongoDB"
                />
                {status.lastTimings.throttle !== undefined && (
                    <HealthMetric
                        icon={<Timer size={20} />}
                        label="Throttle"
                        value={`${status.lastTimings.throttle.toFixed(0)} ms`}
                        detail="Intentional pacing delay"
                    />
                )}
                <HealthMetric
                    icon={<Clock size={20} />}
                    label="Total Time"
                    value={`${totalMs.toFixed(0)} ms`}
                    detail="End-to-end pipeline"
                    tone={totalMs > 3000 ? 'danger' : 'neutral'}
                />
            </Grid>
        </section>
    );
}

interface ObserverPerformanceBlockProps {
    observers: ObserverStats[];
}

/**
 * Per-observer throughput, queue depth, and error tracking.
 *
 * Renders a compact table because each observer's row contains six numeric
 * fields that line up better column-aligned than they would as stacked metric
 * tiles.
 */
function ObserverPerformanceBlock({ observers }: ObserverPerformanceBlockProps) {
    return (
        <section className={styles.subsection}>
            <header className={styles.subsection_header}>
                <h3 className={styles.subsection_title}>Observer Performance</h3>
                <span className={styles.subsection_note}>
                    Observers process transactions asynchronously. High processing times or
                    queue depths may indicate bottlenecks.
                </span>
            </header>

            {observers.length === 0 ? (
                <p className={styles.subsection_note}>
                    <Layers size={16} aria-hidden="true" /> No observers registered.
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
        </section>
    );
}

function getLagTone(lag: number, throttleThreshold: number): 'success' | 'warning' | 'danger' {
    if (lag < throttleThreshold) return 'success';
    if (lag < 100) return 'warning';
    return 'danger';
}

function getLagMetricTone(lag: number, throttleThreshold: number): 'neutral' | 'success' | 'danger' {
    if (lag < throttleThreshold) return 'success';
    if (lag >= 100) return 'danger';
    return 'neutral';
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
