'use client';

/**
 * @fileoverview Activity tab — the live invocation audit feed. Filterable by
 * tool, status, and trigger path, paged through the full history (not just the
 * newest page), and refetched on the `ai-tools:activity` WebSocket signal (a
 * timestamp-only refetch cue — the records themselves come from this admin-gated
 * endpoint, never a global broadcast). Clicking a row opens a slide-over with the
 * full record: arguments, result digest, forensic error, cost, and screen verdict.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { IToolInvocationRecord, IAiToolInfo, ToolInvocationStatus, ToolTriggerPath } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Select } from '../../../../../components/ui/Select';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { Pagination } from '../../../../../components/ui/Pagination';
import { SlideOver } from '../../../../../components/ui/SlideOver';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { getSocket } from '../../../../../lib/socketClient';
import { listActivity, listTools, type IActivityQuery } from '../../../../../modules/ai-tools';
import { InvocationDetailPanel, statusTone } from '../components/InvocationDetailPanel';
import styles from '../page.module.scss';

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
    const [toolName, setToolName] = useState<string>('');
    const [offset, setOffset] = useState(0);
    const [tools, setTools] = useState<IAiToolInfo[]>([]);
    const [selectedRecord, setSelectedRecord] = useState<IToolInvocationRecord | null>(null);
    /**
     * Monotonic load id. A response commits state only while it is still the
     * newest in-flight request, so an out-of-order resolve — rapid filter changes
     * or a socket-driven refetch racing a filter change — never overwrites the
     * table with rows that no longer match the active filter.
     */
    const requestId = useRef(0);

    const load = useCallback(async () => {
        const id = ++requestId.current;
        const query: IActivityQuery = { limit: PAGE_LIMIT, offset };
        if (status) query.status = status;
        if (triggerPath) query.triggerPath = triggerPath;
        if (toolName) query.toolName = toolName;
        try {
            const page = await listActivity(query);
            // Drop a response a newer load already superseded so out-of-order
            // resolves don't overwrite the table with stale rows.
            if (id !== requestId.current) {
                return;
            }
            setItems(page.records);
            setTotal(page.total);
            setError(null);
        } catch (err) {
            if (id !== requestId.current) {
                return;
            }
            setError(err instanceof Error ? err.message : 'Failed to load activity');
        } finally {
            setLoading(false);
        }
    }, [status, triggerPath, toolName, offset]);

    useEffect(() => { void load(); }, [load]);

    // Populate the tool filter once. A failure just leaves the filter empty.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await listTools();
                if (!cancelled) {
                    setTools(list);
                }
            } catch {
                /* secondary data — the tool filter simply offers no choices on failure */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Live refetch on the activity signal (fires after every governed call),
    // keeping the current filters and page.
    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void load(); };
        socket.on('ai-tools:activity', handler);
        return () => { socket.off('ai-tools:activity', handler); };
    }, [load]);

    /**
     * Apply a filter change and reset to the first page, so a narrowed result set
     * never strands the viewer on an out-of-range offset.
     *
     * @param apply - Setter that records the new filter value.
     */
    const changeFilter = useCallback((apply: () => void) => {
        apply();
        setOffset(0);
    }, []);

    const currentPage = Math.floor(offset / PAGE_LIMIT) + 1;

    return (
        <Stack gap="md">
            <div className={styles.filters}>
                <Select
                    value={toolName}
                    onChange={(e) => changeFilter(() => setToolName(e.target.value))}
                    aria-label="Filter by tool"
                >
                    <option value="">All tools</option>
                    {tools.map(tool => (
                        <option key={tool.name} value={tool.name}>{tool.name}</option>
                    ))}
                </Select>
                <Select
                    value={status}
                    onChange={(e) => changeFilter(() => setStatus(e.target.value as ToolInvocationStatus | ''))}
                    aria-label="Filter by status"
                >
                    <option value="">All statuses</option>
                    <option value="ok">ok</option>
                    <option value="denied">denied</option>
                    <option value="pending-approval">pending-approval</option>
                    <option value="error">error</option>
                </Select>
                <Select
                    value={triggerPath}
                    onChange={(e) => changeFilter(() => setTriggerPath(e.target.value as ToolTriggerPath | ''))}
                    aria-label="Filter by trigger path"
                >
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
                ? <div className={styles.placeholder}>No invocations match the current filters.</div>
                : (
                    <>
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
                                        <Tr
                                            key={record.id}
                                            className={styles.tool_row}
                                            hasError={record.status === 'error'}
                                            onClick={() => setSelectedRecord(record)}
                                        >
                                            <Td muted className={styles.col_time}><ClientTime date={record.createdAt} format="datetime" /></Td>
                                            <Td><span className={styles.tool_name}>{record.toolName}</span></Td>
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
                        <div className={styles.pager}>
                            <Pagination
                                total={total}
                                pageSize={PAGE_LIMIT}
                                currentPage={currentPage}
                                onPageChange={(page) => setOffset((page - 1) * PAGE_LIMIT)}
                            />
                        </div>
                    </>
                )}

            <SlideOver
                open={selectedRecord !== null}
                onClose={() => setSelectedRecord(null)}
                label={selectedRecord ? `Invocation ${selectedRecord.toolName}` : undefined}
                title={selectedRecord ? <span className={styles.tool_name}>{selectedRecord.toolName}</span> : null}
            >
                {selectedRecord && <InvocationDetailPanel record={selectedRecord} />}
            </SlideOver>
        </Stack>
    );
}
