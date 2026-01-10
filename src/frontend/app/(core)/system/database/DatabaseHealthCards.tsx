'use client';

import { useEffect, useState, useCallback } from 'react';
import { Database, Activity, Layers, HardDrive, Zap } from 'lucide-react';
import styles from './DatabaseHealthCards.module.css';

/**
 * MongoDB database status metrics.
 *
 * Mirrors the structure returned from the health API endpoint to display
 * connection status, response time, collection count, and database size.
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
 * ClickHouse database status metrics.
 *
 * Mirrors the structure returned from the ClickHouse health API endpoint to display
 * connection status, response time, table count, and database size.
 */
interface ClickHouseStatus {
    connected: boolean;
    responseTime: number | null;
    tableCount: number;
    databaseSize: number | null;
}

/**
 * Properties for the DatabaseHealthCards component.
 */
interface Props {
    /** Admin authentication token */
    token: string;
}

/**
 * DatabaseHealthCards - Database connection status dashboard
 *
 * Displays health metrics for MongoDB and ClickHouse in separate labeled sections
 * at the top of the database page. Each section shows connection status, response
 * time, entity count (collections/tables), and database size.
 *
 * **MongoDB metrics:**
 * - Status (connected/disconnected)
 * - Response Time (ping latency in milliseconds)
 * - Collections count
 * - Size (formatted in MB)
 *
 * **ClickHouse metrics:**
 * - Status (connected/disconnected)
 * - Response Time (ping latency in milliseconds)
 * - Tables count
 * - Size (formatted in MB)
 *
 * Fetches data from both health endpoints in parallel and auto-refreshes every
 * 10 seconds. Cards use color coding (green for healthy, red for disconnected)
 * and icons from lucide-react for visual clarity at a glance.
 *
 * @param props - Component properties with admin token
 * @returns Two labeled sections with horizontal rows of compact metric cards
 */
export function DatabaseHealthCards({ token }: Props) {
    const [database, setDatabase] = useState<DatabaseStatus | null>(null);
    const [clickhouse, setClickhouse] = useState<ClickHouseStatus | null>(null);
    const [loading, setLoading] = useState(true);

    /**
     * Fetches database health data from the admin API endpoints.
     *
     * Uses X-Admin-Token header for authentication. Fetches both MongoDB
     * and ClickHouse status in parallel. Updates component state with the
     * responses and handles errors by logging to console.
     */
    const fetchData = useCallback(async () => {
        if (!token) return;

        try {
            const [mongoResponse, clickhouseResponse] = await Promise.all([
                fetch('/api/admin/system/health/database', {
                    headers: { 'X-Admin-Token': token }
                }),
                fetch('/api/admin/system/health/clickhouse', {
                    headers: { 'X-Admin-Token': token }
                })
            ]);

            if (mongoResponse.ok) {
                const mongoData = await mongoResponse.json();
                setDatabase(mongoData.status);
            }

            if (clickhouseResponse.ok) {
                const clickhouseData = await clickhouseResponse.json();
                setClickhouse(clickhouseData.status);
            }
        } catch (error) {
            console.error('Failed to fetch database health:', error);
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

    if (loading || !database) {
        return (
            <div className={styles.cards}>
                <div className={styles.card}>
                    <p className={styles.loading}>Loading database health...</p>
                </div>
            </div>
        );
    }

    return (
        <>
        {/* MongoDB Section */}
        <div className={styles.section}>
            <div className={styles.section_header}>
                <Database size={16} className={styles.section_icon} />
                <span className={styles.section_title}>MongoDB</span>
            </div>
            <div className={styles.cards}>
                {/* Connection Status Card */}
                <div className={`${styles.card} ${database.connected ? styles.card_healthy : styles.card_danger}`}>
                    <div className={styles.card_icon}>
                        <Database size={20} />
                    </div>
                    <div className={styles.card_content}>
                        <div className={styles.card_label}>Status</div>
                        <div className={styles.card_value}>
                            {database.connected ? 'Connected' : 'Disconnected'}
                        </div>
                    </div>
                </div>

                {/* Response Time Card */}
                {database.responseTime !== null && (
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <Activity size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Response Time</div>
                            <div className={styles.card_value}>{database.responseTime}ms</div>
                        </div>
                    </div>
                )}

                {/* Collections Card */}
                <div className={styles.card}>
                    <div className={styles.card_icon}>
                        <Layers size={20} />
                    </div>
                    <div className={styles.card_content}>
                        <div className={styles.card_label}>Collections</div>
                        <div className={styles.card_value}>{database.collectionCount}</div>
                    </div>
                </div>

                {/* Database Size Card */}
                {database.databaseSize !== null && (
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <HardDrive size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Size</div>
                            <div className={styles.card_value}>{formatBytes(database.databaseSize)}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* ClickHouse Section */}
        {clickhouse && (
            <div className={styles.section}>
                <div className={styles.section_header}>
                    <Zap size={16} className={styles.section_icon} />
                    <span className={styles.section_title}>ClickHouse</span>
                </div>
                <div className={styles.cards}>
                    {/* Connection Status Card */}
                    <div className={`${styles.card} ${clickhouse.connected ? styles.card_healthy : styles.card_danger}`}>
                        <div className={styles.card_icon}>
                            <Zap size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Status</div>
                            <div className={styles.card_value}>
                                {clickhouse.connected ? 'Connected' : 'Disconnected'}
                            </div>
                        </div>
                    </div>

                    {/* Response Time Card */}
                    {clickhouse.responseTime !== null && (
                        <div className={styles.card}>
                            <div className={styles.card_icon}>
                                <Activity size={20} />
                            </div>
                            <div className={styles.card_content}>
                                <div className={styles.card_label}>Response Time</div>
                                <div className={styles.card_value}>{clickhouse.responseTime}ms</div>
                            </div>
                        </div>
                    )}

                    {/* Tables Card */}
                    <div className={styles.card}>
                        <div className={styles.card_icon}>
                            <Layers size={20} />
                        </div>
                        <div className={styles.card_content}>
                            <div className={styles.card_label}>Tables</div>
                            <div className={styles.card_value}>{clickhouse.tableCount}</div>
                        </div>
                    </div>

                    {/* Database Size Card */}
                    {clickhouse.databaseSize !== null && (
                        <div className={styles.card}>
                            <div className={styles.card_icon}>
                                <HardDrive size={20} />
                            </div>
                            <div className={styles.card_content}>
                                <div className={styles.card_label}>Size</div>
                                <div className={styles.card_value}>{formatBytes(clickhouse.databaseSize)}</div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}
        </>
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
