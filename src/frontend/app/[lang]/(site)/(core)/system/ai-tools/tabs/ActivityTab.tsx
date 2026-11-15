'use client';

/**
 * @fileoverview Activity tab — the live invocation audit feed. Filterable by
 * tool, status, trigger path, and caller, paged through the full history (not
 * just the newest page), and refetched on the `ai-tools:activity` WebSocket
 * signal (a timestamp-only refetch cue — the records themselves come from this
 * admin-gated endpoint, never a global broadcast). Clicking a row opens a
 * slide-over with the full record, whose shortcuts can narrow the feed to the
 * same caller or tool.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { RefreshCw, X } from 'lucide-react';
import type { IToolInvocationRecord, IAiToolInfo, ToolInvocationStatus, ToolTriggerPath } from '@/types';
import { Stack } from '../../../../../../../components/layout';
import { Button } from '../../../../../../../components/ui/Button';
import { Select } from '../../../../../../../components/ui/Select';
import { Pagination } from '../../../../../../../components/ui/Pagination';
import { SlideOver } from '../../../../../../../components/ui/SlideOver';
import { getSocket } from '../../../../../../../lib/socketClient';
import { listActivity, listTools, type IActivityQuery } from '../../../../../../../modules/ai-tools';
import { InvocationDetailPanel } from '../components/InvocationDetailPanel';
import { InvocationTable } from '../components/InvocationTable';
import type { IInvocationFilter } from '../components/IInvocationFilter';
import { invocationStatusText } from '../components/invocationStatusText';
import styles from '../page.module.scss';

/** Page size for the feed. */
const PAGE_LIMIT = 50;

/** The statuses offered in the filter, in the order an admin usually looks for them. */
const STATUS_OPTIONS: readonly ToolInvocationStatus[] = ['ok', 'denied', 'error', 'pending-approval'];

/**
 * Props for {@link ActivityTab}.
 */
export interface IActivityTabProps {
    /**
     * Lock the feed to one trigger path and hide that filter. The MCP admin
     * page passes `'mcp'` to show only calls made by users' own AI clients,
     * reusing this feed instead of building a second one. With `'mcp'` the
     * table also swaps in the group and client columns.
     */
    fixedTriggerPath?: ToolTriggerPath;

    /**
     * Lock the feed to calls charged to one user group. The MCP usage view
     * passes it when an admin opens a group's individual calls.
     */
    fixedChargedGroupId?: string;

    /**
     * Lock the feed to one external caller. The MCP usage view passes it when
     * an admin opens one caller's individual calls.
     */
    fixedPrincipalId?: string;
}

/**
 * Activity tab content.
 *
 * @param props - {@link IActivityTabProps}.
 * @returns The tab.
 */
export function ActivityTab({ fixedTriggerPath, fixedChargedGroupId, fixedPrincipalId }: IActivityTabProps = {}) {
    const [items, setItems] = useState<IToolInvocationRecord[]>([]);
    const [userLabels, setUserLabels] = useState<Record<string, string>>({});
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<ToolInvocationStatus | ''>('');
    const [triggerPath, setTriggerPath] = useState<ToolTriggerPath | ''>(fixedTriggerPath ?? '');
    const [toolName, setToolName] = useState<string>('');
    const [principal, setPrincipal] = useState<{ id: string; label: string } | null>(null);
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
    const principalId = fixedPrincipalId ?? principal?.id;

    /** Fetch the current page under the active filters. */
    const load = useCallback(async () => {
        const id = ++requestId.current;
        const query: IActivityQuery = { limit: PAGE_LIMIT, offset };
        if (status) query.status = status;
        if (triggerPath) query.triggerPath = triggerPath;
        if (toolName) query.toolName = toolName;
        if (fixedChargedGroupId) query.chargedGroupId = fixedChargedGroupId;
        if (principalId) query.principalId = principalId;
        try {
            const page = await listActivity(query);
            // Drop a response a newer load already superseded so out-of-order
            // resolves don't overwrite the table with stale rows.
            if (id !== requestId.current) {
                return;
            }
            setItems(page.records);
            setUserLabels(page.userLabels ?? {});
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
    }, [status, triggerPath, toolName, offset, fixedChargedGroupId, principalId]);

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
     */
    const changeFilter = useCallback((apply: () => void) => {
        apply();
        setOffset(0);
    }, []);

    /**
     * Apply a shortcut from the detail panel, such as every call by the caller
     * being viewed, and close the panel so the narrowed feed is in view. A
     * caller filter is ignored where the feed is already locked to one caller.
     *
     * @param filter - The filter the panel asked for.
     */
    const applyPanelFilter = useCallback((filter: IInvocationFilter) => {
        changeFilter(() => {
            if (filter.principalId && !fixedPrincipalId) {
                setPrincipal({ id: filter.principalId, label: filter.principalLabel ?? filter.principalId });
            }
            if (filter.toolName) {
                setToolName(filter.toolName);
            }
        });
        setSelectedRecord(null);
    }, [changeFilter, fixedPrincipalId]);

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
                    aria-label="Filter by outcome"
                >
                    <option value="">All outcomes</option>
                    {STATUS_OPTIONS.map(option => (
                        <option key={option} value={option}>{invocationStatusText[option].label}</option>
                    ))}
                </Select>
                {!fixedTriggerPath && (
                    <Select
                        value={triggerPath}
                        onChange={(e) => changeFilter(() => setTriggerPath(e.target.value as ToolTriggerPath | ''))}
                        aria-label="Filter by trigger path"
                    >
                        <option value="">All triggers</option>
                        <option value="interactive">Query tab (interactive)</option>
                        <option value="scheduled">Saved prompt on a timer (scheduled)</option>
                        <option value="programmatic">Code calling the AI (programmatic)</option>
                        <option value="mcp">Someone&apos;s own AI client (mcp)</option>
                    </Select>
                )}
                {principal && !fixedPrincipalId && (
                    <Button
                        variant="secondary"
                        size="sm"
                        icon={<X size={14} aria-hidden />}
                        onClick={() => changeFilter(() => setPrincipal(null))}
                        aria-label={`Stop showing only calls by ${principal.label}`}
                    >
                        Caller: {principal.label}
                    </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => { void load(); }}>
                    <RefreshCw size={16} /> Refresh
                </Button>
                <span className="text-subtle" style={{ fontSize: 'var(--font-size-body-sm)' }}>
                    {loading ? 'Loading…' : `Showing ${items.length} of ${total.toLocaleString('en-US')}`}
                </span>
            </div>

            {error && <div className="alert" role="alert">{error}</div>}

            {!loading && items.length === 0
                ? <div className={styles.placeholder}>No calls match the current filters.</div>
                : (
                    <>
                        <InvocationTable
                            records={items}
                            onSelect={setSelectedRecord}
                            userLabels={userLabels}
                            mcpColumns={fixedTriggerPath === 'mcp'}
                        />
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
                label={selectedRecord ? `Call to ${selectedRecord.toolName}` : undefined}
                title={selectedRecord ? <span className={styles.tool_name}>{selectedRecord.toolName}</span> : null}
            >
                {selectedRecord && <InvocationDetailPanel record={selectedRecord} userLabels={userLabels} onFilter={applyPanelFilter} />}
            </SlideOver>
        </Stack>
    );
}
