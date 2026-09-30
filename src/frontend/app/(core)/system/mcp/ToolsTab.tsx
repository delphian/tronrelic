'use client';

/**
 * @fileoverview Tools tab of /system/mcp: approve or withdraw each registered
 * AI tool for MCP.
 *
 * Every tool starts hidden. A tool the eligibility floor refuses (anything not
 * read-only, secret data, paid, or undeclared) has its switch disabled with
 * the reason shown, because the server would refuse the approval anyway. A
 * tool whose capability changed after approval is flagged stale and is not
 * served until approved again.
 */

import { useCallback, useEffect, useState } from 'react';
import type { IMcpToolExposure } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Switch } from '../../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { useToast } from '../../../../components/ui/ToastProvider';
import { setMcpToolExposure } from '../../../../modules/mcp';
import styles from './page.module.scss';

/**
 * Props for {@link ToolsTab}.
 */
interface IToolsTabProps {
    /** SSR-fetched tool rows. */
    initialTools: IMcpToolExposure[];
    /** Called with every row after a change, so the overview counts update. */
    onToolsChanged: (tools: IMcpToolExposure[]) => void;
}

/**
 * Describe a row's current MCP state as a badge.
 *
 * @param tool - The tool row.
 * @returns The badge to show in the status column.
 */
function statusBadge(tool: IMcpToolExposure) {
    let badge = <Badge tone="neutral" size="sm">Hidden</Badge>;
    if (tool.ineligibleReason !== null) {
        badge = <Badge tone="neutral" size="sm">Not eligible</Badge>;
    } else if (tool.stale) {
        badge = <Badge tone="warning" size="sm">Changed — re-approve</Badge>;
    } else if (tool.approved && !tool.enabledInRegistry) {
        badge = <Badge tone="warning" size="sm">Approved, disabled in registry</Badge>;
    } else if (tool.served) {
        badge = <Badge tone="success" size="sm">Served</Badge>;
    }
    return badge;
}

/**
 * Render the tool list.
 *
 * @param props - {@link IToolsTabProps}.
 * @returns The tools panel.
 */
export function ToolsTab({ initialTools, onToolsChanged }: IToolsTabProps) {
    const [tools, setTools] = useState<IMcpToolExposure[]>(initialTools);
    const [busy, setBusy] = useState<string | null>(null);
    const { push } = useToast();

    /**
     * Approve or withdraw one tool and replace its row with the server's answer.
     *
     * Switching on a stale tool re-approves it against its current capability,
     * which is the intended way to accept a changed declaration.
     *
     * @param tool - The row being changed.
     * @param next - Whether the tool should be exposed.
     */
    const toggle = useCallback(async (tool: IMcpToolExposure, next: boolean): Promise<void> => {
        setBusy(tool.name);
        try {
            const updated = await setMcpToolExposure(tool.name, next);
            // Functional update, so two toggles finishing close together do
            // not overwrite each other with a stale copy of the list. A null
            // answer means the tool was unregistered after the page loaded:
            // its approval is gone and it has no row, so drop the row.
            setTools(current => updated
                ? current.map(row => row.name === updated.name ? updated : row)
                : current.filter(row => row.name !== tool.name));
        } catch (error) {
            push({ tone: 'danger', title: `Could not update ${tool.name}`, description: error instanceof Error ? error.message : String(error) });
        } finally {
            setBusy(null);
        }
    }, [push]);

    /**
     * Report every change to the rows to the parent, so the overview counts
     * beside the kill switch stay accurate. Runs after the state commits
     * rather than inside the state updater, which must stay free of side effects.
     */
    useEffect(() => {
        onToolsChanged(tools);
    }, [tools, onToolsChanged]);

    return (
        <Stack gap="md">
            <p className={styles.intro}>
                Every tool is hidden from MCP until you switch it on here. Only read-only tools that return no secret
                data and spend no money can be switched on, because an MCP user&apos;s own AI client can always send
                data off-site. If a tool&apos;s capability changes after you approve it, it is hidden again until you re-approve it.
            </p>
            <Card padding="xs">
                <Table flush className={styles.tools_table}>
                    <Thead>
                        <Tr>
                            <Th>Tool</Th>
                            <Th>Capability</Th>
                            <Th>Status</Th>
                            <Th>Expose</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {tools.map(tool => {
                            // An approved tool that has since become ineligible
                            // shows as on, so the only action left, withdrawing
                            // its approval, is one click. Shown as off, the click
                            // would ask to re-approve and the server would refuse.
                            const on = tool.approved && (!tool.stale || tool.ineligibleReason !== null);
                            return (
                                <Tr key={tool.name}>
                                    <Td data-label="Tool">
                                        <div className={styles.tool_name}>{tool.name}</div>
                                        <div className={styles.tool_meta}>{tool.provider}</div>
                                    </Td>
                                    <Td data-label="Capability">
                                        <div className={styles.badge_row}>
                                            {tool.capability ? (
                                                <>
                                                    <Badge tone="neutral" size="sm">{tool.capability.sideEffect}</Badge>
                                                    <Badge tone={tool.capability.sensitivity === 'secret' ? 'danger' : 'neutral'} size="sm">{tool.capability.sensitivity}</Badge>
                                                    {tool.capability.surfacesUntrustedContent && <Badge tone="info" size="sm">untrusted content</Badge>}
                                                    {tool.capability.spendsMoney && <Badge tone="warning" size="sm">paid</Badge>}
                                                </>
                                            ) : (
                                                <Badge tone="warning" size="sm">undeclared</Badge>
                                            )}
                                        </div>
                                    </Td>
                                    <Td data-label="Status">
                                        <Stack gap="sm">
                                            <div>{statusBadge(tool)}</div>
                                            {tool.ineligibleReason && <span className={styles.tool_meta}>{tool.ineligibleReason}</span>}
                                        </Stack>
                                    </Td>
                                    <Td data-label="Expose">
                                        <Switch
                                            on={on}
                                            onChange={next => { void toggle(tool, next); }}
                                            disabled={busy === tool.name || (tool.ineligibleReason !== null && !tool.approved)}
                                            aria-label={`${on ? 'Withdraw' : 'Expose'} ${tool.name} over MCP`}
                                        />
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Tbody>
                </Table>
            </Card>
        </Stack>
    );
}
