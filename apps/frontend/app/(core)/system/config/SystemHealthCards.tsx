'use client';

import { useEffect, useState, useCallback } from 'react';
import { Activity, Server, Database, Cpu, HardDrive, Clock, AlertTriangle } from 'lucide-react';
import styles from './SystemHealthCards.module.css';

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
 * Properties for the SystemHealthCards component.
 */
interface Props {
    /** Admin authentication token */
    token: string;
}

/**
 * SystemHealthCards - Compact system health status display
 *
 * Displays key Redis and Server metrics in a row of small cards at the top of the
 * configuration page. Provides at-a-glance visibility into infrastructure health
 * without requiring navigation to a dedicated health page.
 *
 * **Metrics displayed:**
 *
 * **Redis Cache:**
 * - Connection Status (connected/disconnected)
 * - Response Time (ping latency in milliseconds)
 * - Cached Keys count
 * - Memory Usage (formatted in MB)
 * - Evictions count (indicates memory pressure)
 *
 * **Backend Server:**
 * - Uptime (formatted as days/hours or hours/minutes)
 * - Heap Memory (used vs total)
 * - RSS Memory (Resident Set Size)
 * - CPU Usage percentage
 *
 * The component fetches data from Redis and server health endpoints in parallel
 * and auto-refreshes every 10 seconds to provide near-real-time monitoring. Cards
 * use color coding (green for healthy, red for disconnected) and icons from
 * lucide-react for visual clarity.
 *
 * @param props - Component properties with admin token
 * @returns A horizontal row of compact metric cards
 */
export function SystemHealthCards({ token }: Props) {
    const [redis, setRedis] = useState<RedisStatus | null>(null);
    const [server, setServer] = useState<ServerMetrics | null>(null);
    const [loading, setLoading] = useState(true);

    /**
     * Fetches health data from Redis and server admin endpoints in parallel.
     *
     * Uses X-Admin-Token header for authentication. Updates component state
     * with the response and handles errors by logging to console.
     */
    const fetchData = useCallback(async () => {
        if (!token) return;

        try {
            const [redisRes, serverRes] = await Promise.all([
                fetch('/api/admin/system/health/redis', {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch('/api/admin/system/health/server', {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            if (!redisRes.ok || !serverRes.ok) {
                throw new Error('Failed to fetch health data');
            }

            const [redisData, serverData] = await Promise.all([redisRes.json(), serverRes.json()]);
            setRedis(redisData.status);
            setServer(serverData.metrics);
        } catch (error) {
            console.error('Failed to fetch health data:', error);
        } finally {
            setLoading(false);
        }
    }, [token]);

    /**
     * Sets up auto-refresh interval with 10-second frequency.
     *
     * Cleans up interval on unmount to prevent memory leaks. Initial fetch
     * happens immediately on mount.
     */
    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    if (loading || !redis || !server) {
        return (
            <div className={styles.cards}>
                <div className={styles.card}>
                    <p className={styles.loading}>Loading system health...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* Redis Cache Section */}
            <div className={styles.section}>
                <h3 className={styles.section_title}>Redis Cache</h3>
                <div className={styles.cards}>
                    {/* Redis Connection Status Card */}
                    <div className={`${styles.card} ${redis.connected ? styles.card_healthy : styles.card_danger}`}>
                        <div className={styles.card_icon}>
                            <Database size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Status</div>
                            <div className={styles.card_value}>
                                {redis.connected ? 'Connected' : 'Disconnected'}
                            </div>
                        </div>
                    </div>

                    {/* Redis Response Time Card */}
                    {redis.responseTime !== null && (
                        <div className={styles.card}>
                            <div className={styles.card_icon}>
                                <Activity size={20} />
                            </div>
                            <div className={styles.card_content}>
                                <div className={styles.card_label}>Response Time</div>
                                <div className={styles.card_value}>{redis.responseTime}ms</div>
                            </div>
                        </div>
                    )}

                    {/* Redis Cached Keys Card */}
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <HardDrive size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Cached Keys</div>
                            <div className={styles.card_value}>{redis.keyCount.toLocaleString()}</div>
                        </div>
                    </div>

                    {/* Redis Memory Usage Card */}
                    {redis.memoryUsage !== null && (
                        <div className={styles.card}>
                            <div className={styles.card_icon}>
                                <HardDrive size={20} />
                            </div>
                            <div className={styles.card_content}>
                                <div className={styles.card_label}>Memory Usage</div>
                                <div className={styles.card_value}>{formatBytes(redis.memoryUsage)}</div>
                            </div>
                        </div>
                    )}

                    {/* Redis Evictions Card */}
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <AlertTriangle size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Evictions</div>
                            <div className={styles.card_value}>{redis.evictions.toLocaleString()}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Backend Server Section */}
            <div className={styles.section}>
                <h3 className={styles.section_title}>Backend Server</h3>
                <div className={styles.cards}>
                    {/* Server Uptime Card */}
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <Clock size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Uptime</div>
                            <div className={styles.card_value}>{formatUptime(server.uptime)}</div>
                        </div>
                    </div>

                    {/* Server Heap Memory Card */}
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <Server size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Heap Memory</div>
                            <div className={styles.card_value}>
                                {formatBytes(server.memoryUsage.heapUsed)}
                            </div>
                            <div className={styles.card_detail}>
                                of {formatBytes(server.memoryUsage.heapTotal)}
                            </div>
                        </div>
                    </div>

                    {/* Server RSS Memory Card */}
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <HardDrive size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>RSS Memory</div>
                            <div className={styles.card_value}>{formatBytes(server.memoryUsage.rss)}</div>
                        </div>
                    </div>

                    {/* Server CPU Usage Card */}
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <Cpu size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>CPU Usage</div>
                            <div className={styles.card_value}>{server.cpuUsage.toFixed(1)}%</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * Formats byte values as megabytes with 2 decimal places.
 *
 * @param bytes - Byte count to format
 * @returns Formatted string (e.g., "256.75 MB")
 */
function formatBytes(bytes: number): string {
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
function formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (days > 0) {
        return `${days}d ${hours}h`;
    }
    return `${hours}h ${minutes}m`;
}
