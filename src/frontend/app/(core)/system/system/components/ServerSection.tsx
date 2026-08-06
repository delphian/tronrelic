'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { formatBytes } from '../../../../../lib/format';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { StatStrip } from './StatStrip';
import { REFRESH_INTERVAL_MS, stampRefresh, type IRefreshReport } from './overview-refresh';
import styles from './ServerSection.module.scss';

interface RedisStatus {
    connected: boolean;
    responseTime: number | null;
    memoryUsage: number | null;
    keyCount: number;
    evictions: number;
    hitRate: number | null;
}

interface ServerMetrics {
    uptime: number;
    memoryUsage: {
        heapUsed: number;
        heapTotal: number;
        rss: number;
        external: number;
    };
    cpuUsage: number;
    cpuCoreCount: number;
    activeConnections: number;
    requestRate: number | null;
    errorRate: number | null;
}

interface DiskUsage {
    path: string;
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
}

interface HostMetrics {
    hostname: string;
    platform: string;
    uptime: number;
    cpuCoreCount: number;
    cpuPercent: number | null;
    loadAverage: [number, number, number];
    memoryTotal: number;
    memoryFree: number;
    memoryUsed: number;
    memoryPercent: number;
    disks: DiskUsage[];
}

interface ContainerMetrics {
    id: string;
    name: string;
    service: string | null;
    image: string;
    state: string;
    health: string | null;
    uptime: number | null;
    restartCount: number;
    cpuPercent: number | null;
    memoryUsage: number | null;
    memoryLimit: number | null;
    memoryPercent: number | null;
    isSelf: boolean;
}

interface DockerStatus {
    available: boolean;
    error: string | null;
    containers: ContainerMetrics[];
}

interface InfrastructureStatus {
    host: HostMetrics;
    docker: DockerStatus;
}

/** Severity shared by the stat strip's cells and this section's table rows. */
type Tone = 'success' | 'warning' | 'danger';

/**
 * Inputs for the server console.
 */
interface IServerSectionProps {
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
 * Server / infrastructure health body.
 *
 * Reports the deployment at three altitudes, because any one of them alone
 * left an operator guessing: the droplet (is the machine itself under
 * pressure), each container (which service is responsible), and the two
 * subsystems this process sees from the inside — its Redis connection and its
 * own Node heap. Only the last of those existed before, so a droplet pinned at
 * 90% CPU gave no indication which of the five containers to look at.
 *
 * Polls on the shared Overview cadence while mounted. Each probe degrades
 * independently: an unreachable Docker API empties the container table and
 * nothing else.
 */
export function ServerSection({ onRefresh }: IServerSectionProps) {
    const [redis, setRedis] = useState<RedisStatus | null>(null);
    const [server, setServer] = useState<ServerMetrics | null>(null);
    const [infrastructure, setInfrastructure] = useState<InfrastructureStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const [redisRes, serverRes, infraRes] = await Promise.all([
                fetch(`/api/admin/system/health/redis`),
                fetch(`/api/admin/system/health/server`),
                fetch(`/api/admin/system/health/infrastructure`)
            ]);

            if (redisRes.ok) {
                const redisData = await redisRes.json();
                setRedis(redisData.status);
            } else {
                setRedis(null);
            }
            if (serverRes.ok) {
                const serverData = await serverRes.json();
                setServer(serverData.metrics);
            } else {
                setServer(null);
            }
            if (infraRes.ok) {
                const infraData = await infraRes.json();
                setInfrastructure(infraData.infrastructure);
            } else {
                setInfrastructure(null);
            }

            if (!redisRes.ok && !serverRes.ok && !infraRes.ok) {
                throw new Error(
                    `Health endpoints unavailable (redis ${redisRes.status}, server ${serverRes.status}, infrastructure ${infraRes.status})`
                );
            }
            setError(null);
            onRefresh?.(stampRefresh(true));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch server health');
            onRefresh?.(stampRefresh(false));
        }
    }, [onRefresh]);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), REFRESH_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [fetchData]);

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
            {infrastructure && (
                <div className={styles.block}>
                    <h4 className={styles.block_title}>Droplet</h4>
                    <StatStrip items={buildHostItems(infrastructure.host)} />
                </div>
            )}
            {infrastructure && (
                <div className={styles.block}>
                    <h4 className={styles.block_title}>Containers</h4>
                    <ContainerTable docker={infrastructure.docker} />
                </div>
            )}
            {redis && (
                <div className={styles.block}>
                    <h4 className={styles.block_title}>Redis Cache</h4>
                    <StatStrip
                        items={[
                            {
                                label: 'Status',
                                value: redis.connected ? 'Connected' : 'Disconnected',
                                tone: redis.connected ? 'success' : 'danger'
                            },
                            ...(redis.responseTime !== null
                                ? [{ label: 'Response', value: `${redis.responseTime}ms` }]
                                : []),
                            { label: 'Cached Keys', value: redis.keyCount.toLocaleString() },
                            ...(redis.memoryUsage !== null
                                ? [{ label: 'Memory', value: formatBytes(redis.memoryUsage) }]
                                : []),
                            {
                                label: 'Evictions',
                                value: redis.evictions.toLocaleString(),
                                tone: redis.evictions > 0 ? ('danger' as const) : undefined
                            }
                        ]}
                    />
                </div>
            )}
            {server && (
                <div className={styles.block}>
                    <h4 className={styles.block_title}>Backend Process</h4>
                    <StatStrip
                        items={[
                            { label: 'Uptime', value: formatUptime(server.uptime) },
                            {
                                label: 'Heap',
                                value: formatBytes(server.memoryUsage.heapUsed),
                                detail: `of ${formatBytes(server.memoryUsage.heapTotal)}`
                            },
                            { label: 'RSS', value: formatBytes(server.memoryUsage.rss) },
                            {
                                label: 'CPU',
                                value: `${server.cpuUsage.toFixed(1)}%`,
                                detail: `of one of ${server.cpuCoreCount} cores`
                            }
                        ]}
                    />
                </div>
            )}
        </div>
    );
}

/**
 * Props for the per-container readout.
 */
interface IContainerTableProps {
    /** Sweep result, carrying either containers or the reason there are none. */
    docker: DockerStatus;
}

/**
 * Per-container runtime state, one row each.
 *
 * Uses the shared table primitives so the column alignment, compact density
 * and error-row treatment match every other admin table rather than being
 * reinvented here. Container name is a row header so a screen reader announces
 * "clickhouse, memory, 2.3 GB" instead of reading six unlabelled figures.
 *
 * @param props - The Docker sweep to render.
 * @returns The container table, or an explanatory note when unavailable.
 */
function ContainerTable({ docker }: IContainerTableProps) {
    if (!docker.available) {
        return (
            <p className={styles.unavailable}>
                Container metrics unavailable
                {docker.error ? ` — ${docker.error}` : ''}
            </p>
        );
    }

    if (docker.containers.length === 0) {
        return <p className={styles.unavailable}>No containers reported.</p>;
    }

    return (
        <Table variant="compact">
            <Thead>
                <Tr>
                    <Th scope="col">Container</Th>
                    <Th scope="col">State</Th>
                    <Th scope="col" numeric>CPU</Th>
                    <Th scope="col" numeric>Memory</Th>
                    <Th scope="col" numeric>Uptime</Th>
                    <Th scope="col" numeric>Restarts</Th>
                </Tr>
            </Thead>
            <Tbody>
                {docker.containers.map(container => (
                    <ContainerRow key={container.id} container={container} />
                ))}
            </Tbody>
        </Table>
    );
}

/**
 * Props for a single container row.
 */
interface IContainerRowProps {
    /** The container to describe. */
    container: ContainerMetrics;
}

/**
 * One container's row.
 *
 * Extracted from the table so the grading of a container — which combines
 * lifecycle state, healthcheck verdict, restart count and memory headroom —
 * resolves in one place rather than as expressions inlined across six cells.
 *
 * @param props - The container to describe.
 * @returns The table row.
 */
function ContainerRow({ container }: IContainerRowProps) {
    const tone = containerTone(container);
    const memoryTone = percentTone(container.memoryPercent);

    return (
        <Tr
            hasError={tone === 'danger'}
            className={tone === 'warning' ? styles.row_warning : undefined}
        >
            <Th scope="row" className={styles.name_cell}>
                {container.service ?? container.name}
                {container.isSelf && <span className={styles.self_marker}> (this)</span>}
            </Th>
            <Td>
                <Badge tone={badgeTone(tone)}>
                    {container.health ? `${container.state} · ${container.health}` : container.state}
                </Badge>
            </Td>
            <Td numeric>
                {container.cpuPercent !== null ? `${container.cpuPercent.toFixed(1)}%` : '—'}
            </Td>
            <Td numeric className={memoryTone ? styles[`tone--${memoryTone}`] : undefined}>
                {container.memoryUsage !== null ? formatBytes(container.memoryUsage) : '—'}
                {container.memoryLimit !== null && (
                    <span className={styles.cell_detail}> of {formatBytes(container.memoryLimit)}</span>
                )}
            </Td>
            <Td numeric>{container.uptime !== null ? formatUptime(container.uptime) : '—'}</Td>
            <Td numeric className={container.restartCount > 0 ? styles['tone--warning'] : undefined}>
                {container.restartCount}
            </Td>
        </Tr>
    );
}

/**
 * Assemble the droplet-level stat cells.
 *
 * Disks are spread in rather than fixed in the list because the set varies by
 * deployment — production adds ClickHouse's dedicated block device, which a
 * local Docker stack does not have.
 *
 * @param host - Host metrics from the infrastructure probe.
 * @returns Stat cells ready for the strip.
 */
function buildHostItems(host: HostMetrics) {
    return [
        {
            label: 'Host CPU',
            value: host.cpuPercent !== null ? `${host.cpuPercent.toFixed(1)}%` : '—',
            detail: `${host.cpuCoreCount} cores`,
            tone: percentTone(host.cpuPercent)
        },
        {
            label: 'Load',
            value: host.loadAverage[0].toFixed(2),
            detail: `${host.loadAverage[1].toFixed(2)} · ${host.loadAverage[2].toFixed(2)}`,
            tone: host.loadAverage[0] > host.cpuCoreCount ? ('warning' as const) : undefined
        },
        {
            label: 'Memory',
            value: formatBytes(host.memoryUsed),
            detail: `of ${formatBytes(host.memoryTotal)}`,
            tone: percentTone(host.memoryPercent)
        },
        ...host.disks.map(disk => ({
            label: `Disk ${disk.path}`,
            value: `${disk.usedPercent.toFixed(0)}%`,
            detail: `${formatBytes(disk.freeBytes)} free`,
            tone: percentTone(disk.usedPercent)
        })),
        { label: 'Host Uptime', value: formatUptime(host.uptime) }
    ];
}

/**
 * Grade a container's overall condition.
 *
 * Ordered by severity so the worst signal wins: a container that has stopped
 * matters more than one that has restarted, which matters more than one merely
 * still starting up.
 *
 * @param container - The container to grade.
 * @returns The tone, or undefined when nothing warrants attention.
 */
function containerTone(container: ContainerMetrics): Tone | undefined {
    let tone: Tone | undefined;

    if (container.state !== 'running' || container.health === 'unhealthy') {
        tone = 'danger';
    } else if (container.restartCount > 0 || container.health === 'starting') {
        tone = 'warning';
    }

    return tone;
}

/**
 * Grade a saturation percentage against shared thresholds.
 *
 * Shared by CPU, memory and disk so one resource does not begin warning at a
 * different level than another for no reason an operator could predict.
 *
 * @param percent - Utilization from 0 to 100, or null when unmeasured.
 * @returns The tone, or undefined below the warning threshold.
 */
function percentTone(percent: number | null): Tone | undefined {
    let tone: Tone | undefined;

    if (percent !== null) {
        if (percent >= 90) {
            tone = 'danger';
        } else if (percent >= 75) {
            tone = 'warning';
        }
    }

    return tone;
}

/**
 * Map a row's grade onto the badge's tone vocabulary.
 *
 * An ungraded container is healthy, which the badge expresses as `success`
 * rather than `neutral` — a row with nothing wrong should read as confirmed
 * good, not as unknown.
 *
 * @param tone - The row's grade, if any.
 * @returns The tone to give the state badge.
 */
function badgeTone(tone: Tone | undefined): 'success' | 'warning' | 'danger' {
    return tone ?? 'success';
}

/**
 * Render a duration as the two largest units that still fit.
 *
 * Operators read these to answer "did this restart recently", so precision
 * below a minute is noise and a full breakdown is harder to scan.
 *
 * @param seconds - Elapsed seconds.
 * @returns A compact duration such as `3d 4h` or `12h 30m`.
 */
function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h ${minutes}m`;
}
