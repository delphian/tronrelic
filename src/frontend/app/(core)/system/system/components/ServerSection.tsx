'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { StatStrip } from './StatStrip';
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
 * Polls every 10s while mounted. Renders both subsystems as tight
 * StatStrip rows so the section keeps to roughly two screen lines on
 * a desktop console instead of two stacked tile grids.
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
        <div className={styles.subsection}>
            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={14} aria-hidden="true" />
                        {error}
                    </span>
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
                    <h4 className={styles.block_title}>Backend Server</h4>
                    <StatStrip
                        items={[
                            { label: 'Uptime', value: formatUptime(server.uptime) },
                            {
                                label: 'Heap',
                                value: formatBytes(server.memoryUsage.heapUsed),
                                detail: `of ${formatBytes(server.memoryUsage.heapTotal)}`
                            },
                            { label: 'RSS', value: formatBytes(server.memoryUsage.rss) },
                            { label: 'CPU', value: `${server.cpuUsage.toFixed(1)}%` }
                        ]}
                    />
                </div>
            )}
        </div>
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
