'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, Layers, Play } from 'lucide-react';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { StatStrip } from './StatStrip';
import { LAG_DANGER_BLOCKS, resolveLagWarningBlocks } from './lag-thresholds';
import { REFRESH_INTERVAL_MS, stampRefresh, type IRefreshReport } from './overview-refresh';
import styles from './BlockchainSection.module.scss';

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
    backfillEntryBlocks: number;
    /**
     * Blocks the syncer deliberately holds back from the chain head, zero
     * unless a deployment configured distance from the tip. A deployment that
     * sets one reports that figure as its lag rather than zero, which is why
     * the tone thresholds offset by it.
     */
    liveTipReserveBlocks: number;
    blockIntervalSeconds: number;
    /** Height of the last block actually broadcast, null before the first one. */
    lastEmittedBlockNumber: number | null;
    /**
     * Blocks between the chain head and the last broadcast block — the delay a
     * viewer actually experiences, as opposed to `lag`, which is how far
     * indexing is behind. The two differ by the emitter's buffer depth.
     */
    feedLag: number;
    /** Blocks the emitter is holding; the lead available to cover a hiccup. */
    emitBufferDepth: number;
    /** The lead the emitter aims to hold, used to judge depth and offset tone. */
    emitBufferTargetDepth: number;
    /** False while the emitter is still building its initial lead after a restart. */
    emitBufferSeeded: boolean;
    /** Separate episodes of the buffer running out of lead; any increase means the feed was exposed. */
    emitBufferUnderruns: number;
    /** Blocks released during those episodes, which is how long they lasted. */
    emitBufferUnderrunBlocks: number;
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
 * Block period assumed until the status payload resolves, or when it omits the
 * field. Mirrors `blockIntervalSeconds`' own default so a console rendered
 * before its first poll lands still judges pipeline timing the way a default
 * deployment behaves.
 */
const BLOCK_INTERVAL_SECONDS_FALLBACK = 3;

/**
 * Overshoot above one block period that still counts as normal per-block
 * variance. Beyond it the Total figure turns amber.
 */
const PIPELINE_TOTAL_WARNING_OVERSHOOT_MS = 20;

/**
 * Overshoot above one block period at which a cycle is slow enough to lose
 * ground against the chain rather than merely arrive late. Beyond it the figure
 * turns red.
 */
const PIPELINE_TOTAL_DANGER_OVERSHOOT_MS = 100;

/**
 * Inputs for the blockchain console.
 */
interface IBlockchainSectionProps {
    /**
     * Called once per completed poll cycle with its outcome.
     *
     * The Overview tab's refresh readout has no probe of its own, so it can only
     * report staleness that the consoles tell it about. Must be referentially
     * stable — it feeds the polling effect's dependency list, and a fresh
     * identity each render would tear down and restart the interval.
     */
    onRefresh?: (report: IRefreshReport) => void;
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
export function BlockchainSection({ onRefresh }: IBlockchainSectionProps) {
    const [status, setStatus] = useState<BlockchainStatus | null>(null);
    const [metrics, setMetrics] = useState<BlockProcessingMetrics | null>(null);
    const [observers, setObservers] = useState<ObserverStats[]>([]);
    const [schedulerEnabled, setSchedulerEnabled] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncing, setSyncing] = useState(false);

    const fetchData = useCallback(async () => {
        try {
            const [statusRes, metricsRes, observersRes, schedulerRes] = await Promise.all([
                fetch(`/api/admin/system/blockchain/status`),
                fetch(`/api/admin/system/blockchain/metrics`),
                fetch(`/api/admin/system/blockchain/observers`),
                fetch(`/api/admin/system/scheduler/health`)
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
            onRefresh?.(stampRefresh(true));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch blockchain data');
            onRefresh?.(stampRefresh(false));
        }
    }, [onRefresh]);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchData]);

    const triggerSync = async () => {
        if (syncing) return;
        setSyncing(true);
        setError(null);
        try {
            const response = await fetch(`/api/admin/system/blockchain/sync`, {
                method: 'POST'
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
    // A negative catch-up rate on its own is not a fault. Ingestion no longer
    // paces itself, so it drains each tick's blocks in a burst and then idles,
    // which makes the measured rate cross zero constantly while the syncer sits
    // exactly at the chain head. Lag is what separates the two: a rate below
    // zero only matters once ingestion has actually fallen behind far enough
    // that the syncer would stop treating blocks as live work.
    const fallingBehind =
        netCatchUpRate !== null &&
        netCatchUpRate < 0 &&
        status !== null &&
        status.lag > status.liveChainThrottleBlocks;

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
                        ? 'Scheduler is running blockchain:sync automatically'
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
                            label: 'Index Lag',
                            value: status.lag.toLocaleString(),
                            detail: status.averageProcessingDelaySeconds !== null
                                ? `${formatDuration(status.averageProcessingDelaySeconds)} behind`
                                : `${status.lag.toLocaleString()} blocks behind`,
                            tone: getLagMetricTone(status.lag, status.backfillEntryBlocks, status.liveTipReserveBlocks)
                        },
                        {
                            // Reported separately from Index Lag because the two
                            // now say different things. Ingestion runs at the
                            // chain head, so Index Lag is near zero whether or
                            // not the feed is healthy; this is the delay a
                            // viewer sees, and it sits near the buffer target by
                            // design rather than by accident.
                            label: 'Feed Lag',
                            value: status.feedLag.toLocaleString(),
                            detail: `${status.emitBufferTargetDepth} block buffer by design`,
                            tone: getLagMetricTone(
                                status.feedLag,
                                status.backfillEntryBlocks,
                                status.emitBufferTargetDepth
                            )
                        },
                        {
                            label: 'Buffer',
                            value: `${status.emitBufferDepth} / ${status.emitBufferTargetDepth}`,
                            detail: resolveBufferDetail(status),
                            tone: getBufferTone(status)
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
                    {
                        label: 'Total',
                        value: `${totalMs.toFixed(0)} ms`,
                        detail: 'End-to-end',
                        tone: getPipelineTotalTone(totalMs, status.blockIntervalSeconds)
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

/**
 * Colour a lag figure by how far behind the chain it is.
 *
 * Used for both lag cells. The amber step comes from the payload's own entry
 * threshold, so a figure turns amber exactly where the syncer stops treating
 * blocks as live work, even in a deployment that tuned that edge. Only the
 * danger step is a console judgement. Both resolve through
 * `lag-thresholds.ts`, so the same lag reads identically wherever it appears.
 *
 * @param lag - Blocks behind the network head, either the index cursor's or the feed's.
 * @param backfillEntryBlocks - Entry threshold from the status payload; the syncer's own mode boundary.
 * @param heldBackBlocks - Blocks this deployment holds on purpose, also from the payload: the buffer
 *                         target for feed lag, the live tip reserve for index lag. Passed through
 *                         because the lag counts from the head and includes the deliberate hold, so
 *                         without it the cell warns that many blocks early on a healthy deployment.
 * @returns The tone the stat cell should carry.
 */
function getLagMetricTone(
    lag: number,
    backfillEntryBlocks: number,
    heldBackBlocks: number
): 'success' | 'warning' | 'danger' {
    if (lag >= LAG_DANGER_BLOCKS) return 'danger';
    if (lag >= resolveLagWarningBlocks(backfillEntryBlocks, heldBackBlocks)) return 'warning';
    return 'success';
}

/**
 * Colour the Buffer figure by whether the feed still has a lead to spend.
 *
 * Depth alone does not say whether the buffer is doing its job, because a
 * healthy buffer dips below target routinely and refills. What matters is
 * whether it has ever hit zero: at zero there is no lead left and the next
 * upstream gap reaches the screen, which is the failure the buffer exists to
 * prevent. An underrun therefore outranks a shallow-but-nonzero depth.
 *
 * @param status - The blockchain status payload, read for buffer depth, target,
 *                 the seeded flag, and the underrun count.
 * @returns The tone the Buffer stat cell should carry, or undefined while the
 *          buffer is still seeding, when it is expected to be short and
 *          colouring it would report a fault during normal startup.
 */
function getBufferTone(status: BlockchainStatus): 'success' | 'warning' | 'danger' | undefined {
    if (!status.emitBufferSeeded) return undefined;
    if (status.emitBufferUnderruns > 0) return 'warning';
    if (status.emitBufferDepth === 0) return 'danger';
    return 'success';
}

/**
 * Describe what the Buffer figure means right now, in the cell's detail line.
 *
 * The count alone leaves an operator guessing whether a short buffer is a
 * startup artefact, a fault, or normal refill, so the detail names which of
 * those is happening. The underrun count is surfaced first when it is nonzero,
 * because it is the number that says the target depth is too small for what
 * this deployment's provider actually does.
 *
 * @param status - The blockchain status payload.
 * @returns A short phrase for the detail line under the Buffer value.
 */
function resolveBufferDetail(status: BlockchainStatus): string {
    let detail: string;

    if (!status.emitBufferSeeded) {
        detail = 'Building initial lead';
    } else if (status.emitBufferUnderruns > 0) {
        // Both figures, because either one alone misleads. The episode count
        // cannot separate a provider that hiccups from one that cannot keep up,
        // and the block count cannot say whether it was one long stretch or many
        // short ones.
        const episodes = `${status.emitBufferUnderruns.toLocaleString()} underrun${status.emitBufferUnderruns === 1 ? '' : 's'}`;
        const blocks = `${status.emitBufferUnderrunBlocks.toLocaleString()} block${status.emitBufferUnderrunBlocks === 1 ? '' : 's'} exposed`;

        detail = `${episodes} since boot, ${blocks}`;
    } else if (status.emitBufferDepth < status.emitBufferTargetDepth) {
        detail = 'Refilling toward target';
    } else {
        detail = 'Blocks held for the feed';
    }

    return detail;
}

/**
 * Colour the pipeline Total figure by how far it overshoots one block period.
 *
 * Total is now pure work — no cycle waits on a clock, because the broadcast
 * wait moved to the emitter — so a healthy Total sits well *below* one block
 * period rather than at it. The threshold is still one block period, but it
 * means something different than it used to: a cycle costing more than the
 * chain takes to produce a block cannot keep up with production, so ingestion
 * will fall behind and the emitter's buffer will drain. The steps are kept
 * rather than tightened because a single slow block is normal and a strict rule
 * trains operators to ignore the cell.
 *
 * The period itself is read from the status payload rather than assumed,
 * because a deployment can set `blockIntervalSeconds`
 * (`BLOCKCHAIN_BLOCK_INTERVAL_SECONDS`) to something other than TRON's three
 * and would otherwise show every healthy cycle in red — recreating the exact
 * alert fatigue these steps exist to remove. The value is guarded because it
 * arrives over the network: it is absent before the first poll resolves and
 * could be missing or nonsensical from a mismatched backend.
 *
 * @param totalMs - End-to-end duration of the last block cycle, in milliseconds.
 * @param blockIntervalSeconds - Block period echoed by the status payload; the rate the chain produces at.
 * @returns The tone the Total stat cell should carry, or `undefined` to leave it neutral when the cycle keeps up.
 */
function getPipelineTotalTone(
    totalMs: number,
    blockIntervalSeconds: number | null | undefined
): 'warning' | 'danger' | undefined {
    const intervalSeconds =
        typeof blockIntervalSeconds === 'number' && Number.isFinite(blockIntervalSeconds) && blockIntervalSeconds > 0
            ? blockIntervalSeconds
            : BLOCK_INTERVAL_SECONDS_FALLBACK;
    const blockPeriodMs = intervalSeconds * 1000;

    if (totalMs > blockPeriodMs + PIPELINE_TOTAL_DANGER_OVERSHOOT_MS) return 'danger';
    if (totalMs > blockPeriodMs + PIPELINE_TOTAL_WARNING_OVERSHOOT_MS) return 'warning';
    return undefined;
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
