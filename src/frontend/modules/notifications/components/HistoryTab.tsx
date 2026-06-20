'use client';

import { useCallback, useEffect, useState } from 'react';
import type { NotificationSeverity } from '@/types';
import { Badge } from '../../../components/ui/Badge';
import { ClientTime } from '../../../components/ui/ClientTime';
import { getHistory, type IAuditRecordView } from '../api/notifications.api';
import styles from './admin.module.scss';

/** Badge tone per severity — `'error'` reads as the danger tone. */
const SEVERITY_TONE: Record<NotificationSeverity, 'info' | 'success' | 'warning' | 'danger'> = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    error: 'danger'
};

/**
 * Admin History tab — the audit feed of every notification blast.
 *
 * Each row records what fired, to how many recipients, and how many deliveries
 * were suppressed by policy or per-user opt-out, newest first. Labels and counts
 * are snapshots, so history stays readable even after a firing plugin (and its
 * category) is gone. Client component behind the admin-gated page.
 *
 * @returns The audit history list.
 */
export function HistoryTab(): React.ReactElement {
    const [records, setRecords] = useState<IAuditRecordView[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async (): Promise<void> => {
        try {
            const { records: rows, total: count } = await getHistory({ limit: 100 });
            setRecords(rows);
            setTotal(count);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load history');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    if (loading) {
        return <p className={styles.placeholder}>Loading history…</p>;
    }
    if (error) {
        return <p className={styles.placeholder}>{error}</p>;
    }
    if (records.length === 0) {
        return <p className={styles.placeholder}>No notifications have been sent yet.</p>;
    }

    return (
        <div className={styles.list}>
            <p className={styles.help}>{total} notification{total === 1 ? '' : 's'} recorded (showing up to 100, newest first).</p>
            {records.map((record) => {
                const delivered = record.channels.reduce((sum, c) => sum + c.delivered, 0);
                return (
                    <div key={record.id} className={styles.row}>
                        <div className={styles.row_main}>
                            <div className={styles.history_head}>
                                <Badge tone={SEVERITY_TONE[record.severity]}>{record.severity}</Badge>
                                <span className={styles.row_title}>{record.title}</span>
                            </div>
                            {record.body && <div className={styles.row_desc}>{record.body}</div>}
                            <div className={styles.badges}>
                                <Badge tone="neutral">{record.categoryLabel}</Badge>
                                <Badge tone="neutral">{record.source}</Badge>
                            </div>
                        </div>
                        <div className={styles.history_meta}>
                            <span className={styles.help}>
                                <ClientTime date={record.createdAt} format="datetime" />
                            </span>
                            <span className={styles.help}>
                                {delivered} delivered · {record.suppressedCount} suppressed · {record.recipientCount} targeted
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
