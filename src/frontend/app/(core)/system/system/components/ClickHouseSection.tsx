'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { getRuntimeConfig } from '../../../../../lib/runtimeConfig';
import { StatStrip } from './StatStrip';
import { ClickHouseTableBrowser } from './ClickHouseTableBrowser';
import styles from './ClickHouseSection.module.scss';

interface Props {
    token: string;
}

interface ClickHouseStatus {
    connected: boolean;
    responseTime: number | null;
    tableCount: number;
    databaseSize: number | null;
}

/**
 * ClickHouse administration body — health and table browser.
 *
 * Lives as its own console row separate from MongoDB. Health polls
 * every 10s; the table browser fetches stats once on mount and rows
 * on demand when a table is expanded.
 *
 * Table browse endpoints (`/api/admin/clickhouse/{stats,tables/:name/rows}`)
 * are mounted by ClickHouseModule.run() at boot. When ClickHouse is not
 * configured (`CLICKHOUSE_HOST` unset), the routes never mount and the
 * health endpoint reports `connected: false` — the browser surfaces an
 * empty state instead of erroring.
 */
export function ClickHouseSection({ token }: Props) {
    const [clickhouse, setClickhouse] = useState<ClickHouseStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const runtimeConfig = getRuntimeConfig();

    const fetchData = useCallback(async () => {
        try {
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/system/health/clickhouse`, {
                headers: { 'X-Admin-Token': token }
            });

            if (response.ok) {
                const data = await response.json();
                setClickhouse(data.status);
            } else {
                setClickhouse(null);
                throw new Error(`Health endpoint unavailable (${response.status})`);
            }
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch ClickHouse health');
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

            <div className={styles.block}>
                <h4 className={styles.block_title}>Health</h4>
                {clickhouse ? (
                    <StatStrip
                        items={[
                            {
                                label: 'Status',
                                value: clickhouse.connected ? 'Connected' : 'Disconnected',
                                tone: clickhouse.connected ? 'success' : 'danger'
                            },
                            ...(clickhouse.responseTime !== null
                                ? [{ label: 'Response', value: `${clickhouse.responseTime}ms` }]
                                : []),
                            { label: 'Tables', value: clickhouse.tableCount.toLocaleString() },
                            ...(clickhouse.databaseSize !== null
                                ? [{ label: 'Size', value: formatBytes(clickhouse.databaseSize) }]
                                : [])
                        ]}
                    />
                ) : (
                    <p className={styles.empty}>ClickHouse is not configured.</p>
                )}
            </div>

            {clickhouse?.connected && (
                <div className={styles.block}>
                    <h4 className={styles.block_title}>Table Browser</h4>
                    <ClickHouseTableBrowser token={token} />
                </div>
            )}
        </div>
    );
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}
