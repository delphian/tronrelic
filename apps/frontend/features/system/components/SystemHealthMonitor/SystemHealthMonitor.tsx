'use client';

import { useEffect, useState } from 'react';
import { config as runtimeConfig } from '../../../../lib/config';
import { cn } from '../../../../lib/cn';
import styles from './SystemHealthMonitor.module.css';

/**
 * MongoDB database status metrics.
 */
interface DatabaseStatus {
    connected: boolean;
    responseTime: number | null;
    poolSize: number;
    availableConnections: number;
    databaseSize: number | null;
    collectionCount: number;
    recentErrors: string[];
}

/**
 * Redis cache status metrics.
 */
interface RedisStatus {
    connected: boolean;
    responseTime: number | null;
    memoryUsage: number | null;
    keyCount: number;
    evictions: number;
    hitRate: number | null;
}

/**
 * Backend server performance metrics.
 */
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
 * Properties for the SystemHealthMonitor component.
 */
interface Props {
    /** Admin authentication token */
    token: string;
}

/**
 * SystemHealthMonitor - Detailed infrastructure health monitoring dashboard
 *
 * Provides in-depth health metrics for critical infrastructure components:
 *
 * **MongoDB Database:**
 * - Connection status (connected/disconnected)
 * - Response time (ping latency)
 * - Database size and collection count
 * - Recent error log
 *
 * **Redis Cache:**
 * - Connection status
 * - Response time
 * - Memory usage and cached key count
 * - Eviction count (indicates memory pressure)
 *
 * **Backend Server:**
 * - Process uptime
 * - Heap memory usage (used vs total)
 * - RSS (Resident Set Size) memory
 * - CPU utilization percentage
 *
 * The component fetches data from three separate admin endpoints in parallel
 * for efficiency. It auto-refreshes every 5 seconds (more frequent than
 * SystemOverview) to provide near-real-time monitoring.
 *
 * Color coding: Green for healthy/connected, red for errors/disconnected.
 *
 * @param props - Component properties with admin token
 * @returns A grid of detailed health metric sections
 */
export function SystemHealthMonitor({ token }: Props) {
    const [database, setDatabase] = useState<DatabaseStatus | null>(null);
    const [redis, setRedis] = useState<RedisStatus | null>(null);
    const [server, setServer] = useState<ServerMetrics | null>(null);
    const [loading, setLoading] = useState(true);

    /**
     * Fetches health data from all three admin endpoints in parallel.
     *
     * Uses Promise.all for concurrent requests to minimize latency.
     * Authenticated using X-Admin-Token header.
     */
    const fetchData = async () => {
        try {
            const [dbRes, redisRes, serverRes] = await Promise.all([
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/health/database`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/health/redis`, {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch(`${runtimeConfig.apiBaseUrl}/admin/system/health/server`, {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            const [dbData, redisData, serverData] = await Promise.all([dbRes.json(), redisRes.json(), serverRes.json()]);
            setDatabase(dbData.status);
            setRedis(redisData.status);
            setServer(serverData.metrics);
        } catch (error) {
            console.error('Failed to fetch health data:', error);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Sets up auto-refresh interval with 5-second frequency.
     * Cleans up interval on unmount to prevent memory leaks.
     */
    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    if (loading) {
        return <div className={styles.loading_state}>Loading system health data...</div>;
    }

    return (
        <div className={styles.container}>
            {/* MongoDB Status */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>MongoDB Database</h2>
                {database && (
                    <>
                        <div className={styles.metrics_grid}>
                            <div className={cn(
                                styles.metric_card,
                                database.connected ? styles['metric-card--healthy'] : styles['metric-card--danger']
                            )}>
                                <div className={styles.metric_card__label}>Connection Status</div>
                                <div className={styles.metric_card__value}>
                                    {database.connected ? 'Connected' : 'Disconnected'}
                                </div>
                            </div>

                            {database.responseTime !== null && (
                                <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                                    <div className={styles.metric_card__label}>Response Time</div>
                                    <div className={styles.metric_card__value}>{database.responseTime}ms</div>
                                </div>
                            )}

                            <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                                <div className={styles.metric_card__label}>Collections</div>
                                <div className={styles.metric_card__value}>{database.collectionCount}</div>
                            </div>

                            {database.databaseSize !== null && (
                                <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                                    <div className={styles.metric_card__label}>Database Size</div>
                                    <div className={styles.metric_card__value}>{formatBytes(database.databaseSize)}</div>
                                </div>
                            )}
                        </div>

                        {database.recentErrors.length > 0 && (
                            <div className={styles.error_panel}>
                                <div className={styles.error_panel__title}>Recent Errors:</div>
                                <div className={styles.error_panel__list}>
                                    {database.recentErrors.map((error, idx) => (
                                        <div key={idx}>{error}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </section>

            {/* Redis Status */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Redis Cache</h2>
                {redis && (
                    <div className={styles.metrics_grid}>
                        <div className={cn(
                            styles.metric_card,
                            redis.connected ? styles['metric-card--healthy'] : styles['metric-card--danger']
                        )}>
                            <div className={styles.metric_card__label}>Connection Status</div>
                            <div className={styles.metric_card__value}>
                                {redis.connected ? 'Connected' : 'Disconnected'}
                            </div>
                        </div>

                        {redis.responseTime !== null && (
                            <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                                <div className={styles.metric_card__label}>Response Time</div>
                                <div className={styles.metric_card__value}>{redis.responseTime}ms</div>
                            </div>
                        )}

                        <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                            <div className={styles.metric_card__label}>Cached Keys</div>
                            <div className={styles.metric_card__value}>{redis.keyCount.toLocaleString()}</div>
                        </div>

                        {redis.memoryUsage !== null && (
                            <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                                <div className={styles.metric_card__label}>Memory Usage</div>
                                <div className={styles.metric_card__value}>{formatBytes(redis.memoryUsage)}</div>
                            </div>
                        )}

                        <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                            <div className={styles.metric_card__label}>Evictions</div>
                            <div className={styles.metric_card__value}>{redis.evictions.toLocaleString()}</div>
                        </div>
                    </div>
                )}
            </section>

            {/* Server Metrics */}
            <section className={styles.section}>
                <h2 className={styles.section__title}>Backend Server</h2>
                {server && (
                    <div className={styles.metrics_grid}>
                        <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                            <div className={styles.metric_card__label}>Uptime</div>
                            <div className={styles.metric_card__value}>{formatUptime(server.uptime)}</div>
                        </div>

                        <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                            <div className={styles.metric_card__label}>Heap Memory</div>
                            <div className={styles.metric_card__value}>
                                {formatBytes(server.memoryUsage.heapUsed)}
                            </div>
                            <div className={styles.metric_card__detail}>
                                of {formatBytes(server.memoryUsage.heapTotal)}
                            </div>
                        </div>

                        <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                            <div className={styles.metric_card__label}>RSS Memory</div>
                            <div className={styles.metric_card__value}>{formatBytes(server.memoryUsage.rss)}</div>
                        </div>

                        <div className={cn(styles.metric_card, styles['metric-card--default'])}>
                            <div className={styles.metric_card__label}>CPU Usage</div>
                            <div className={styles.metric_card__value}>{server.cpuUsage.toFixed(1)}%</div>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

/**
 * Formats byte values as megabytes with 2 decimal places.
 *
 * @param bytes - Byte count to format
 * @returns Formatted string (e.g., "256.75 MB")
 */
function formatBytes(bytes: number) {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
}

/**
 * Formats seconds as days/hours or hours/minutes.
 *
 * Shows days and hours if uptime exceeds 24 hours,
 * otherwise shows hours and minutes.
 *
 * @param seconds - Uptime in seconds
 * @returns Formatted uptime string (e.g., "3d 12h" or "4h 25m")
 */
function formatUptime(seconds: number) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    return `${hours}h ${minutes}m`;
}
