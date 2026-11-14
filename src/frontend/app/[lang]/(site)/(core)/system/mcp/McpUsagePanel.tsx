'use client';

/**
 * @fileoverview The usage view on the Overview tab of /system/mcp.
 *
 * Starts lean: endpoint totals and one row per group, read from the ClickHouse
 * `mcp_calls` table, so an operator sees at a glance whether calls are
 * succeeding, which group is near its daily pool, and whether limits are
 * refusing calls. Each level opens the next on request: a group shows its
 * tools and busiest callers, a tool narrows the callers to that tool, and a
 * caller opens the governor's audit feed filtered to their individual calls.
 *
 * The first level arrives with the page (server rendered); the deeper levels
 * are fetched when the admin clicks, which is the user-triggered loading the
 * SSR rule allows.
 */

import { useCallback, useState } from 'react';
import type { IMcpGroup, IMcpUsageCallerRow, IMcpUsageFigures, IMcpUsageGroupDetail, IMcpUsageGroupRow, IMcpUsageReport, McpUsageWindow } from '@/types';
import { Stack } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { Button } from '../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { Panel } from '../../../../../../components/ui/Panel';
import { SegmentedControl } from '../../../../../../components/ui/SegmentedControl';
import { StatGrid, StatTile } from '../../../../../../components/ui/StatTile';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import { getMcpUsage, getMcpUsageGroupDetail } from '../../../../../../modules/mcp';
import { ActivityTab } from '../ai-tools/tabs/ActivityTab';
import styles from './page.module.scss';

/** The windows the view offers, in display order. */
const WINDOWS: ReadonlyArray<{ id: McpUsageWindow; label: string }> = [
    { id: '24h', label: '24h' },
    { id: '7d', label: '7d' },
    { id: '30d', label: '30d' }
];

/**
 * Props for {@link McpUsagePanel}.
 */
interface IMcpUsagePanelProps {
    /** The 24-hour report fetched during server rendering; null when the fetch failed. */
    initialUsage: IMcpUsageReport | null;
    /** The groups with their display names, so rows show names rather than ids. */
    groups: IMcpGroup[];
}

/**
 * Format a count for a table cell.
 *
 * @param value - The count.
 * @returns The count with thousands separators.
 */
function count(value: number): string {
    return value.toLocaleString('en-US');
}

/**
 * Describe how much of a group's daily pool it has used, for the groups table.
 *
 * @param row - The group's usage row.
 * @returns A badge, or a dash when the group sets no pooled limit.
 */
function poolBadge(row: IMcpUsageGroupRow) {
    let badge = <span className={styles.tool_meta}>No pool limit</span>;
    if (row.poolCallsPerDay !== null) {
        const share = row.callsLast24h / row.poolCallsPerDay;
        const tone = share >= 1 ? 'danger' : share >= 0.8 ? 'warning' : 'neutral';
        badge = <Badge tone={tone} size="sm">{`${count(row.callsLast24h)} / ${count(row.poolCallsPerDay)}`}</Badge>;
    }
    return badge;
}

/**
 * Render the figures every usage row shares, as table cells.
 *
 * @param figures - The row's figures.
 * @returns The cells, in the order of {@link figureHeaders}.
 */
function figureCells(figures: IMcpUsageFigures) {
    return (
        <>
            <Td data-label="Calls" numeric>{count(figures.calls)}</Td>
            <Td data-label="Refused" numeric muted={figures.refused === 0}>{count(figures.refused)}</Td>
            <Td data-label="By a limit" numeric muted={figures.limited === 0}>{count(figures.limited)}</Td>
            <Td data-label="Failed" numeric muted={figures.failed === 0}>{count(figures.failed)}</Td>
            <Td data-label="p95" numeric muted>{figures.p95DurationMs === null ? '—' : `${count(figures.p95DurationMs)} ms`}</Td>
        </>
    );
}

/**
 * Render the header cells matching {@link figureCells}.
 *
 * @returns The header cells.
 */
function figureHeaders() {
    return (
        <>
            <Th numeric>Calls</Th>
            <Th numeric>Refused</Th>
            <Th numeric>By a limit</Th>
            <Th numeric>Failed</Th>
            <Th numeric>p95</Th>
        </>
    );
}

/**
 * Render the usage view.
 *
 * @param props - {@link IMcpUsagePanelProps}.
 * @returns The usage panels.
 */
export function McpUsagePanel({ initialUsage, groups }: IMcpUsagePanelProps) {
    const [usage, setUsage] = useState<IMcpUsageReport | null>(initialUsage);
    const [usageWindow, setUsageWindow] = useState<McpUsageWindow>(initialUsage?.window ?? '24h');
    const [detail, setDetail] = useState<IMcpUsageGroupDetail | null>(null);
    const [caller, setCaller] = useState<IMcpUsageCallerRow | null>(null);
    const [busy, setBusy] = useState(false);
    const { push } = useToast();
    const names = new Map(groups.map(group => [group.id, group.name]));

    /**
     * Load one group's detail, optionally narrowed to one tool, and show it.
     *
     * @param groupId - The group to open.
     * @param toolName - The tool to narrow the callers to, or null for every tool.
     * @param inWindow - The window to read, passed explicitly so a window
     *   change can reload the open group before state settles.
     */
    const openGroup = useCallback(async (groupId: string, toolName: string | null, inWindow: McpUsageWindow): Promise<void> => {
        setBusy(true);
        try {
            setDetail(await getMcpUsageGroupDetail(groupId, inWindow, toolName));
            setCaller(null);
        } catch (error) {
            push({ tone: 'danger', title: `Could not load usage for ${groupId}`, description: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    }, [push]);

    /**
     * Switch the window, reloading the totals and the open group, if any.
     *
     * @param next - The window to show.
     */
    const changeWindow = useCallback(async (next: McpUsageWindow): Promise<void> => {
        setUsageWindow(next);
        setBusy(true);
        try {
            setUsage(await getMcpUsage(next));
            if (detail) {
                setDetail(await getMcpUsageGroupDetail(detail.groupId, next, detail.toolName));
                setCaller(null);
            }
        } catch (error) {
            push({ tone: 'danger', title: 'Could not load MCP usage', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(false);
        }
    }, [detail, push]);

    const totals = usage?.totals;
    return usage === null || totals === undefined ? (
        <div className="alert" role="alert">MCP usage could not be loaded. Refresh the page to try again.</div>
    ) : (
        <Stack gap="md">
            <Panel
                title="Usage"
                titleAs="h3"
                meta={<>From <ClientTime date={usage.windowStart} format="short" /> to now. Every call to either endpoint, charged to one group.</>}
                actions={(
                    <SegmentedControl
                        label="Usage window"
                        value={usageWindow}
                        options={WINDOWS}
                        disabled={busy}
                        onChange={
                            next => { void changeWindow(next); }
                        }
                    />
                )}
            >
                {usage.available ? (
                    <Stack gap="md">
                        <StatGrid size="sm">
                            <StatTile size="sm" label="Calls" value={count(totals.calls)} tone={totals.calls > 0 ? 'primary' : 'neutral'} />
                            <StatTile size="sm" label="Refused" value={count(totals.refused)} tone={totals.refused > 0 ? 'warning' : 'neutral'} note={`${count(totals.limited)} by a limit`} />
                            <StatTile size="sm" label="Failed" value={count(totals.failed)} tone={totals.failed > 0 ? 'danger' : 'neutral'} note="Tool ran and errored" />
                            <StatTile size="sm" label="Callers" value={count(totals.callers)} note="Accounts and anonymous networks" />
                        </StatGrid>
                        <Table flush>
                            <Thead>
                                <Tr>
                                    <Th>Group</Th>
                                    {figureHeaders()}
                                    <Th numeric>Callers</Th>
                                    <Th>Pool, last 24h</Th>
                                    <Th>Open</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {usage.groups.map(row => (
                                    <Tr key={row.groupId} isExpanded={detail?.groupId === row.groupId}>
                                        <Td data-label="Group">
                                            <div className={styles.tool_name}>{names.get(row.groupId) ?? row.groupId}</div>
                                            {!row.enabled && <Badge tone="warning" size="xs">Switched off</Badge>}
                                        </Td>
                                        {figureCells(row)}
                                        <Td data-label="Callers" numeric>{count(row.callers)}</Td>
                                        <Td data-label="Pool, last 24h">{poolBadge(row)}</Td>
                                        <Td data-label="Open">
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                disabled={busy}
                                                aria-label={`Show tools and callers for ${names.get(row.groupId) ?? row.groupId}`}
                                                onClick={
                                                    () => { void openGroup(row.groupId, null, usageWindow); }
                                                }
                                            >
                                                Details
                                            </Button>
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </Stack>
                ) : (
                    <div className="alert" role="status">{usage.unavailableReason ?? 'MCP usage is not available.'}</div>
                )}
            </Panel>

            {detail && detail.available && (
                <Panel
                    title={`Tools charged to ${names.get(detail.groupId) ?? detail.groupId}`}
                    titleAs="h3"
                    meta="Choose a tool to see only the callers of that tool."
                    actions={(
                        <Button size="xs" variant="ghost" onClick={
                            () => { setDetail(null); setCaller(null); }
                        }>
                            Close
                        </Button>
                    )}
                >
                    {detail.tools.length === 0 ? (
                        <p className={styles.intro}>No calls were charged to this group in the window.</p>
                    ) : (
                        <Table flush>
                            <Thead>
                                <Tr>
                                    <Th>Tool</Th>
                                    {figureHeaders()}
                                    <Th numeric>Callers</Th>
                                    <Th>Callers list</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {detail.tools.map(row => (
                                    <Tr key={row.toolName} isExpanded={detail.toolName === row.toolName}>
                                        <Td data-label="Tool"><span className={styles.tool_name}>{row.toolName}</span></Td>
                                        {figureCells(row)}
                                        <Td data-label="Callers" numeric>{count(row.callers)}</Td>
                                        <Td data-label="Callers list">
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                disabled={busy}
                                                aria-label={detail.toolName === row.toolName ? `Show callers of every tool` : `Show only callers of ${row.toolName}`}
                                                onClick={
                                                    () => { void openGroup(detail.groupId, detail.toolName === row.toolName ? null : row.toolName, usageWindow); }
                                                }
                                            >
                                                {detail.toolName === row.toolName ? 'All tools' : 'Only this'}
                                            </Button>
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    )}
                </Panel>
            )}

            {detail && detail.available && (
                <Panel
                    title={detail.toolName ? `Callers of ${detail.toolName}` : 'Busiest callers'}
                    titleAs="h3"
                    meta="Anonymous callers are counted by network range and shown by a hashed id; no address is stored."
                >
                    {detail.callers.length === 0 ? (
                        <p className={styles.intro}>No callers in the window.</p>
                    ) : (
                        <Table flush>
                            <Thead>
                                <Tr>
                                    <Th>Caller</Th>
                                    {figureHeaders()}
                                    <Th>Last call</Th>
                                    <Th>Calls</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {detail.callers.map(row => (
                                    <Tr key={`${row.principalKind}:${row.principalId}`} isExpanded={caller?.principalId === row.principalId}>
                                        <Td data-label="Caller">
                                            <div className={styles.tool_name}>{row.label}</div>
                                            <div className={styles.tool_meta}>
                                                {row.principalKind === 'anonymous' ? 'Anonymous' : 'Signed in'}
                                                {row.clientNames.length > 0 && ` · ${row.clientNames.join(', ')}`}
                                            </div>
                                        </Td>
                                        {figureCells(row)}
                                        <Td data-label="Last call"><ClientTime date={row.lastCallAt} format="relative" /></Td>
                                        <Td data-label="Calls">
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                aria-label={`Show the individual calls of ${row.label}`}
                                                onClick={
                                                    () => setCaller(caller?.principalId === row.principalId ? null : row)
                                                }
                                            >
                                                {caller?.principalId === row.principalId ? 'Hide' : 'Show'}
                                            </Button>
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    )}
                </Panel>
            )}

            {detail && caller && (
                <Panel title={`Calls by ${caller.label}`} titleAs="h3" meta="Every call this caller made through this group, newest first, from the audit trail.">
                    <ActivityTab
                        key={`${detail.groupId}:${caller.principalId}`}
                        fixedTriggerPath="mcp"
                        fixedChargedGroupId={detail.groupId}
                        fixedPrincipalId={caller.principalId}
                    />
                </Panel>
            )}
        </Stack>
    );
}
