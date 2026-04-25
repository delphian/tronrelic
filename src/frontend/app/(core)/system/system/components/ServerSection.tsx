'use client';

import { useState, useEffect, useCallback } from 'react';
import {
    Activity,
    AlertCircle,
    AlertTriangle,
    Clock,
    Cpu,
    Database,
    HardDrive,
    Server
} from 'lucide-react';
import { Stack, Grid } from '../../../../../components/layout';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { HealthMetric } from './HealthMetric';
import styles from './ServerSection.module.scss';

interface Props {
    token: string;
}

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
    activeConnections: number;
    requestRate: number | null;
    errorRate: number | null;
}

/**
 * Server / cache health body — Redis cache and Node.js process metrics.
 *
 * Restored from the legacy /system/config page so operators retain in-product
 * visibility into Redis liveness and backend memory/CPU during incidents.
 * Polls every 10 seconds and only mounts when the section is expanded so the
 * page does not poll until needed.
 */
export function ServerSection({ token }: Props) {
    const [redis, setRedis] = useState<RedisStatus | null>(null);
    const [server, setServer] = useState<ServerMetrics | null>(null);
    const [error, setError] = useState<string | null>(null);
    const runtimeConfig = getRuntimeConfig();

    const fetchData = useCallback(async () => {
        try {
            const [redisRes, serverRes] = await Promise.all([
                fetch(`${runtimeConfig.apiUrl}/admin/system/health/redis`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiUrl}/admin/system/health/server`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            // Each backend returns its own status independently; surface the
            // failure (and clear stale data) per-backend so a transient
            // outage doesn't keep showing "Connected" forever.
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

            if (!redisRes.ok && !serverRes.ok) {
                throw new Error(
                    `Health endpoints unavailable (redis ${redisRes.status}, server ${serverRes.status})`
                );
            }
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch server health');
        }
    }, [token, runtimeConfig.apiUrl]);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    return (
        <section className={styles.subsection}>
            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={16} aria-hidden="true" />
                        {error}
                    </span>
                </div>
            )}
            {redis && (
                <Stack gap="sm">
                    <h4 className={styles.subsection_subtitle}>Redis Cache</h4>
                    <Grid columns="responsive" gap="sm">
                        <HealthMetric
                            icon={<Database size={20} />}
                            label="Status"
                            value={redis.connected ? 'Connected' : 'Disconnected'}
                            tone={redis.connected ? 'success' : 'danger'}
                        />
                        {redis.responseTime !== null && (
                            <HealthMetric
                                icon={<Activity size={20} />}
                                label="Response Time"
                                value={`${redis.responseTime}ms`}
                            />
                        )}
                        <HealthMetric
                            icon={<HardDrive size={20} />}
                            label="Cached Keys"
                            value={redis.keyCount.toLocaleString()}
                        />
                        {redis.memoryUsage !== null && (
                            <HealthMetric
                                icon={<HardDrive size={20} />}
                                label="Memory Usage"
                                value={formatBytes(redis.memoryUsage)}
                            />
                        )}
                        <HealthMetric
                            icon={<AlertTriangle size={20} />}
                            label="Evictions"
                            value={redis.evictions.toLocaleString()}
                            tone={redis.evictions > 0 ? 'danger' : 'neutral'}
                        />
                    </Grid>
                </Stack>
            )}
            {server && (
                <Stack gap="sm">
                    <h4 className={styles.subsection_subtitle}>Backend Server</h4>
                    <Grid columns="responsive" gap="sm">
                        <HealthMetric
                            icon={<Clock size={20} />}
                            label="Uptime"
                            value={formatUptime(server.uptime)}
                        />
                        <HealthMetric
                            icon={<Server size={20} />}
                            label="Heap Memory"
                            value={formatBytes(server.memoryUsage.heapUsed)}
                            detail={`of ${formatBytes(server.memoryUsage.heapTotal)}`}
                        />
                        <HealthMetric
                            icon={<HardDrive size={20} />}
                            label="RSS Memory"
                            value={formatBytes(server.memoryUsage.rss)}
                        />
                        <HealthMetric
                            icon={<Cpu size={20} />}
                            label="CPU Usage"
                            value={`${server.cpuUsage.toFixed(1)}%`}
                        />
                    </Grid>
                </Stack>
            )}
        </section>
    );
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    return `${hours}h ${minutes}m`;
}
