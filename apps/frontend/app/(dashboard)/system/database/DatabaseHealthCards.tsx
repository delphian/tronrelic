'use client';

import { useEffect, useState, useCallback } from 'react';
import { Database, Activity, Layers, HardDrive } from 'lucide-react';
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
 * Properties for the DatabaseHealthCards component.
 */
interface Props {
    /** Admin authentication token */
    token: string;
}

/**
 * DatabaseHealthCards - Compact MongoDB health status display
 *
 * Displays key MongoDB metrics in a row of small cards at the top of the
 * database migrations page. Provides at-a-glance visibility into database
 * health without requiring navigation to the dedicated health page.
 *
 * **Metrics displayed:**
 * - Connection Status (connected/disconnected)
 * - Response Time (ping latency in milliseconds)
 * - Collections count
 * - Database Size (formatted in MB)
 *
 * The component fetches data from the database health endpoint and auto-refreshes
 * every 10 seconds to provide near-real-time monitoring. Cards use color coding
 * (green for healthy, red for disconnected) and icons from lucide-react for
 * visual clarity.
 *
 * @param props - Component properties with admin token
 * @returns A horizontal row of compact metric cards
 */
export function DatabaseHealthCards({ token }: Props) {
    const [database, setDatabase] = useState<DatabaseStatus | null>(null);
    const [loading, setLoading] = useState(true);

    /**
     * Fetches database health data from the admin API endpoint.
     *
     * Uses X-Admin-Token header for authentication. Updates component state
     * with the response and handles errors by logging to console.
     */
    const fetchData = useCallback(async () => {
        if (!token) return;

        try {
            const response = await fetch('/api/admin/system/health/database', {
                headers: { 'X-Admin-Token': token }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch database health: ${response.statusText}`);
            }

            const data = await response.json();
            setDatabase(data.status);
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
        <div className={styles.cards}>
            {/* Connection Status Card */}
            <div className={`${styles.card} ${database.connected ? styles.card_healthy : styles.card_danger}`}>
                <div className={styles.card_icon}>
                    <Database size={20} />
                </div>
                <div className={styles.card_content}>
                    <div className={styles.card_label}>Connection Status</div>
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
                        <div className={styles.card_label}>Database Size</div>
                        <div className={styles.card_value}>{formatBytes(database.databaseSize)}</div>
                    </div>
                </div>
            )}
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
