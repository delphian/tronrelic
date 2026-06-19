'use client';

/**
 * @fileoverview Activity tab — the live invocation audit feed. Filterable by
 * tool, status, and trigger path; refetches on the `ai-tools:activity` WebSocket
 * signal (a timestamp-only refetch cue — the records themselves come from this
 * admin-gated endpoint, never a global broadcast).
 */

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import type { IToolInvocationRecord, ToolInvocationStatus, ToolTriggerPath } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Select } from '../../../../../components/ui/Select';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getSocket } from '../../../../../lib/socketClient';
import { listActivity, type IActivityQuery } from '../../../../../modules/ai-tools';
import styles from '../page.module.scss';

/** Map an invocation status to a badge tone. */
function statusTone(status: ToolInvocationStatus): 'success' | 'warning' | 'danger' | 'info' {
    switch (status) {
        case 'ok': return 'success';
        case 'denied': return 'warning';
        case 'pending-approval': return 'info';
        default: return 'danger';
    }
}

/** Page size for the feed. */
const PAGE_LIMIT = 50;

/**
 * Activity tab content.
 *
 * @returns The tab.
 */
export function ActivityTab() {
    const [items, setItems] = useState<IToolInvocationRecord[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<ToolInvocationStatus | ''>('');
    const [triggerPath, setTriggerPath] = useState<ToolTriggerPath | ''>('');

    const load = useCallback(async () => {
        const query: IActivityQuery = { limit: PAGE_LIMIT };
        if (status) query.status = status;
        if (triggerPath) query.triggerPath = triggerPath;
        try {
            const page = await listActivity(query);
            setItems(page.records);
            setTotal(page.total);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load activity');
        } finally {
            setLoading(false);
        }
    }, [status, triggerPath]);

    useEffect(() => { void load(); }, [load]);

    // Live refetch on the activity signal (fires after every governed call).
    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void load(); };
        socket.on('ai-tools:activity', handler);
        return () => { socket.off('ai-tools:activity', handler); };
    }, [load]);

    return (
        <Stack gap="md">
            <div className={styles.filters}>
                <Select value={status} onChange={(e) => setStatus(e.target.value as ToolInvocationStatus | '')} aria-label="Filter by status">
                    <option value="">All statuses</option>
                    <option value="ok">ok</option>
                    <option value="denied">denied</option>
                    <option value="pending-approval">pending-approval</option>
                    <option value="error">error</option>
                </Select>
                <Select value={triggerPath} onChange={(e) => setTriggerPath(e.target.value as ToolTriggerPath | '')} aria-label="Filter by trigger path">
                    <option value="">All triggers</option>
                    <option value="interactive">interactive</option>
                    <option value="scheduled">scheduled</option>
                    <option value="programmatic">programmatic</option>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => { void load(); }}>
                    <RefreshCw size={16} /> Refresh
                </Button>
                <span className="text-subtle" style={{ fontSize: 'var(--font-size-body-sm)' }}>
                    {loading ? 'Loading…' : `Showing ${items.length} of ${total}`}
                </span>
            </div>

            {error && <div className="alert" role="alert">{error}</div>}

            {!loading && items.length === 0
                ? <div className={styles.placeholder}>No invocations recorded yet.</div>
                : (
                    <div className="table-scroll">
                        <Table>
                            <Thead>
                                <Tr>
                                    <Th width="shrink" className={styles.col_time}>Time</Th>
                                    <Th>Tool</Th>
                                    <Th width="shrink">AI Provider</Th>
                                    <Th width="shrink">Actor</Th>
                                    <Th width="shrink">Trigger</Th>
                                    <Th width="shrink">Status</Th>
                                    <Th width="shrink">Duration</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {items.map(record => (
                                    <Tr key={record.id} hasError={record.status === 'error'}>
                                        <Td muted className={styles.col_time}><ClientTime date={record.createdAt} format="datetime" /></Td>
                                        <Td>
                                            <div className={styles.tool_name}>{record.toolName}</div>
                                            {record.error && <div className={styles.mono}>{record.error}</div>}
                                        </Td>
                                        <Td muted>{record.aiProviderId}</Td>
                                        <Td muted>{record.actor.kind}{record.actor.id ? ` · ${record.actor.id}` : ''}</Td>
                                        <Td muted>{record.triggerPath}</Td>
                                        <Td><Badge tone={statusTone(record.status)}>{record.status}</Badge></Td>
                                        <Td muted>{record.durationMs}ms</Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </div>
                )}
        </Stack>
    );
}
