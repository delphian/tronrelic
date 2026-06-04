'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { formatBytes } from '../../../../../lib/format';
import { StatStrip } from './StatStrip';
import { ClickHouseTableBrowser } from './ClickHouseTableBrowser';
import styles from './ClickHouseSection.module.scss';

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
export function ClickHouseSection() {
    const [clickhouse, setClickhouse] = useState<ClickHouseStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const response = await fetch(`/api/admin/system/health/clickhouse`);

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
    }, []);

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
                    <ClickHouseTableBrowser />
                </div>
            )}
        </div>
    );
}

