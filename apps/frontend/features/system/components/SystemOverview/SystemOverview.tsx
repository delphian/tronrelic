'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../../../lib/cn';
import styles from './SystemOverview.module.css';

/**
 * Blockchain error details.
 */
interface BlockchainError {
    /** ISO timestamp when error occurred */
    at: string;
    /** Block number where error occurred */
    blockNumber: number;
    /** Error message */
    message: string;
}

/**
 * Complete system overview data structure.
 */
interface SystemOverviewData {
    blockchain: {
        currentBlock: number;
        networkBlock: number;
        lag: number;
        isHealthy: boolean;
        lastError: string | BlockchainError | null;
        lastErrorAt: string | null;
    };
    transactions: {
        totalIndexed: number;
        indexedToday: number;
    };
    scheduler: {
        enabled: boolean;
        uptime: number | null;
    };
    markets: {
        stalePlatformCount: number;
        averageDataAge: number;
    };
    database: {
        connected: boolean;
        responseTime: number | null;
    };
    redis: {
        connected: boolean;
        responseTime: number | null;
    };
    server: {
        uptime: number;
        memoryUsage: {
            heapUsed: number;
            heapTotal: number;
        };
    };
}

/**
 * Properties for the SystemOverview component.
 */
interface Props {
    /** Admin authentication token */
    token: string;
}

/**
 * SystemOverview - Real-time system health monitoring dashboard
 *
 * Displays comprehensive system status including:
 * - **Blockchain sync** - Current block, lag, health status, and recent errors
 * - **Transaction indexing** - Today's count and total indexed transactions
 * - **Scheduler** - Enabled/disabled status and uptime
 * - **Market data** - Stale platform count and average data age
 * - **Database** - MongoDB connection status and response time
 * - **Redis** - Connection status and ping latency
 * - **Server** - Process uptime and memory usage (heap)
 *
 * The component auto-refreshes every 10 seconds to provide near-real-time
 * monitoring. Status cards use color coding:
 * - Green: Healthy/Connected
 * - Yellow: Warning (scheduler disabled, stale data)
 * - Red: Error/Disconnected
 *
 * Authentication is required via X-Admin-Token header. The component
 * should only be accessible to administrators.
 *
 * @param props - Component properties with admin token
 * @returns A grid of status cards showing system health metrics
 */
export function SystemOverview({ token }: Props) {
    const [data, setData] = useState<SystemOverviewData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    /**
     * Fetches system overview data from the admin API.
     *
     * Authenticated using the X-Admin-Token header. Updates state
     * with the latest metrics or sets error state on failure.
     */
    const fetchData = async () => {
        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/system/overview`, {
                headers: {
                    'X-Admin-Token': token
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch system overview');
            }

            const result = await response.json();
            setData(result.overview);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    /**
     * Sets up auto-refresh interval on mount.
     * Fetches immediately, then every 10 seconds.
     * Cleans up interval on unmount to prevent memory leaks.
     */
    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token]);

    if (loading) {
        return <div className={styles.loading_state}>Loading system overview...</div>;
    }

    if (error) {
        return <div className={styles.error_state}>Error: {error}</div>;
    }

    if (!data) {
        return <div className={styles.loading_state}>No data available</div>;
    }

    return (
        <div className={styles.container}>
            <div className={styles.grid}>
                {/* Blockchain Status */}
                <div className={cn(
                    styles.card,
                    data.blockchain.isHealthy ? styles['card--healthy'] : styles['card--danger']
                )}>
                    <h3 className={styles.card__title}>Blockchain Sync</h3>
                    <p className={styles.card__value}>
                        {data.blockchain.isHealthy ? '✓' : '⚠'}
                    </p>
                    <p className={styles.card__detail}>
                        Block {data.blockchain.currentBlock.toLocaleString()}
                        {data.blockchain.lag > 0 && (
                            <span style={{ opacity: 0.7 }}> ({data.blockchain.lag} behind)</span>
                        )}
                    </p>
                    {data.blockchain.lastError && (
                        <p className={styles.card__error}>
                            Error: {typeof data.blockchain.lastError === 'string'
                                ? data.blockchain.lastError
                                : `Block ${data.blockchain.lastError.blockNumber}: ${data.blockchain.lastError.message}`}
                        </p>
                    )}
                </div>

                {/* Transaction Stats */}
                <div className={cn(styles.card, styles['card--default'])}>
                    <h3 className={styles.card__title}>Transactions</h3>
                    <p className={styles.card__value}>
                        {data.transactions.indexedToday.toLocaleString()}
                    </p>
                    <p className={styles.card__detail}>
                        Today ({data.transactions.totalIndexed.toLocaleString()} total)
                    </p>
                    <p className={styles.card__note}>
                        Whale alerts are emitted by the whale alerts plugin and are no longer counted here.
                    </p>
                </div>

                {/* Scheduler Status */}
                <div className={cn(
                    styles.card,
                    data.scheduler.enabled ? styles['card--healthy'] : styles['card--warning']
                )}>
                    <h3 className={styles.card__title}>Scheduler</h3>
                    <p className={styles.card__value}>
                        {data.scheduler.enabled ? 'Running' : 'Disabled'}
                    </p>
                    {data.scheduler.uptime && (
                        <p className={styles.card__detail}>
                            Uptime: {formatUptime(data.scheduler.uptime)}
                        </p>
                    )}
                </div>

                {/* Market Data */}
                <div className={cn(
                    styles.card,
                    data.markets.stalePlatformCount === 0 ? styles['card--healthy'] : styles['card--warning']
                )}>
                    <h3 className={styles.card__title}>Market Data</h3>
                    <p className={styles.card__value}>
                        {data.markets.stalePlatformCount === 0 ? 'Fresh' : `${data.markets.stalePlatformCount} Stale`}
                    </p>
                    <p className={styles.card__detail}>
                        Avg age: {data.markets.averageDataAge.toFixed(1)} min
                    </p>
                </div>
            </div>

            <div className={styles.grid}>
                {/* Database */}
                <div className={cn(
                    styles.card,
                    data.database.connected ? styles['card--healthy'] : styles['card--danger']
                )}>
                    <h3 className={styles.card__title}>MongoDB</h3>
                    <p className={styles.card__value}>
                        {data.database.connected ? '✓' : '✗'}
                    </p>
                    {data.database.responseTime !== null && (
                        <p className={styles.card__detail}>
                            Ping: {data.database.responseTime}ms
                        </p>
                    )}
                </div>

                {/* Redis */}
                <div className={cn(
                    styles.card,
                    data.redis.connected ? styles['card--healthy'] : styles['card--danger']
                )}>
                    <h3 className={styles.card__title}>Redis</h3>
                    <p className={styles.card__value}>
                        {data.redis.connected ? '✓' : '✗'}
                    </p>
                    {data.redis.responseTime !== null && (
                        <p className={styles.card__detail}>
                            Ping: {data.redis.responseTime}ms
                        </p>
                    )}
                </div>

                {/* Server */}
                <div className={cn(styles.card, styles['card--default'])}>
                    <h3 className={styles.card__title}>Server</h3>
                    <p className={styles.card__value}>
                        {formatUptime(data.server.uptime)}
                    </p>
                    <p className={styles.card__detail}>
                        Memory: {formatBytes(data.server.memoryUsage.heapUsed)} / {formatBytes(data.server.memoryUsage.heapTotal)}
                    </p>
                </div>
            </div>
        </div>
    );
}

/**
 * Formats byte values as megabytes with 2 decimal places.
 *
 * @param bytes - Byte count to format
 * @returns Formatted string (e.g., "128.45 MB")
 */
function formatBytes(bytes: number) {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(2)} MB`;
}

/**
 * Formats seconds as hours and minutes (e.g., "3h 45m").
 *
 * @param seconds - Uptime in seconds
 * @returns Formatted uptime string
 */
function formatUptime(seconds: number) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
}
