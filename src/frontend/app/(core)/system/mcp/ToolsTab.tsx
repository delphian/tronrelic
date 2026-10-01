'use client';

/**
 * @fileoverview Tools tab of /system/mcp: choose a user group, set its
 * protections, and grant or withdraw each registered AI tool for it.
 *
 * Every tool starts hidden. The admin picks the group to manage at the top;
 * the protections card and the switch column below then act on that group,
 * and the Access column shows every group a tool is granted to, so the whole
 * picture is visible without changing the selection.
 *
 * A restricted tool (one that fails the MCP safety rules: secret data, a side
 * effect, paid, or undeclared) can never be granted to mcp-users, and can be
 * granted to another group only after "Allow restricted tools" is switched on
 * for it. A tool whose capability changed after it was granted is flagged and
 * is not served until granted again.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IMcpGroup, IMcpGroupPolicy, IMcpToolExposure, IMcpToolGrant } from '@/types';
import { mcpGroupMayHoldTool } from '@/types';
import { Card } from '../../../../components/ui/Card';
import { Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Field } from '../../../../components/ui/Field';
import { Select } from '../../../../components/ui/Select';
import { Switch } from '../../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { useToast } from '../../../../components/ui/ToastProvider';
import { listMcpTools, setMcpToolExposure } from '../../../../modules/mcp';
import { GroupPolicyCard } from './GroupPolicyCard';
import styles from './page.module.scss';

/**
 * Props for {@link ToolsTab}.
 */
interface IToolsTabProps {
    /** SSR-fetched tool rows. */
    initialTools: IMcpToolExposure[];
    /** SSR-fetched user groups with their MCP settings, mcp-users first. */
    initialGroups: IMcpGroup[];
    /** Called with every row after a change, so the overview counts update. */
    onToolsChanged: (tools: IMcpToolExposure[]) => void;
}

/**
 * Decide whether a group may hold a grant for a tool right now.
 *
 * @param tool - The tool row.
 * @param group - The group being managed.
 * @returns True when the tool passes the safety rules, or the group allows restricted tools.
 */
function groupMayHold(tool: IMcpToolExposure, group: IMcpGroup): boolean {
    return mcpGroupMayHoldTool(tool.restrictedReason !== null, group.policy);
}

/**
 * Describe a tool's state for the managed group as a badge.
 *
 * @param tool - The tool row.
 * @param group - The group being managed.
 * @param grant - The group's grant for the tool, when it has one.
 * @returns The badge to show in the status column.
 */
function statusBadge(tool: IMcpToolExposure, group: IMcpGroup, grant: IMcpToolGrant | undefined) {
    let badge = <Badge tone="neutral" size="sm">Hidden</Badge>;
    // A grant the group may no longer hold is reported before staleness: its
    // switch shows as on so the only action is to withdraw it, and "grant
    // again" would point the admin at a request the server refuses.
    if (!grant && !groupMayHold(tool, group)) {
        badge = <Badge tone="neutral" size="sm">Restricted</Badge>;
    } else if (grant && !groupMayHold(tool, group)) {
        badge = <Badge tone="warning" size="sm">Blocked — restricted</Badge>;
    } else if (grant?.stale) {
        badge = <Badge tone="warning" size="sm">Changed — grant again</Badge>;
    } else if (grant && !tool.enabledInRegistry) {
        badge = <Badge tone="warning" size="sm">Granted, disabled in registry</Badge>;
    } else if (grant?.served) {
        badge = <Badge tone={tool.restrictedReason === null ? 'success' : 'danger'} size="sm">{tool.restrictedReason === null ? 'Served' : 'Served — restricted'}</Badge>;
    }
    return badge;
}

/**
 * Explain under the status badge why a tool cannot be granted to the managed group.
 *
 * @param tool - The tool row.
 * @param group - The group being managed.
 * @returns The sentence to show, or null when the tool can be granted.
 */
function restrictionNote(tool: IMcpToolExposure, group: IMcpGroup): string | null {
    let note: string | null = null;
    if (tool.restrictedReason !== null && group.isGateGroup) {
        note = `${tool.restrictedReason} Restricted tools can only be granted to a narrower group.`;
    } else if (tool.restrictedReason !== null && !group.policy.allowRestrictedTools) {
        note = `${tool.restrictedReason} Turn on "Allow restricted tools" for ${group.name} to grant it.`;
    }
    return note;
}

/**
 * Render the group selector, the managed group's protections, and the tool list.
 *
 * @param props - {@link IToolsTabProps}.
 * @returns The tools panel.
 */
export function ToolsTab({ initialTools, initialGroups, onToolsChanged }: IToolsTabProps) {
    const [tools, setTools] = useState<IMcpToolExposure[]>(initialTools);
    const [groups, setGroups] = useState<IMcpGroup[]>(initialGroups);
    const [selectedId, setSelectedId] = useState<string>(initialGroups[0]?.id ?? '');
    const [busy, setBusy] = useState<string | null>(null);
    const { push } = useToast();

    const selected = groups.find(group => group.id === selectedId) ?? groups[0] ?? null;
    const groupNames = useMemo(() => new Map(groups.map(group => [group.id, group.name])), [groups]);
    const restrictedGrantCount = selected
        ? tools.filter(tool => tool.restrictedReason !== null && tool.grants.some(grant => grant.groupId === selected.id)).length
        : 0;

    /**
     * Grant or withdraw one tool for the managed group and replace its row
     * with the server's answer.
     *
     * Switching on a stale grant grants the tool again against its current
     * capability, which is the intended way to accept a changed declaration.
     *
     * @param tool - The row being changed.
     * @param next - Whether the tool should be granted.
     */
    const toggle = useCallback(async (tool: IMcpToolExposure, next: boolean): Promise<void> => {
        if (selected) {
            setBusy(tool.name);
            try {
                const updated = await setMcpToolExposure(tool.name, selected.id, next);
                // Functional update, so two toggles finishing close together do
                // not overwrite each other with a stale copy of the list. A null
                // answer means the tool was unregistered after the page loaded:
                // its grant is gone and it has no row, so drop the row.
                setTools(current => updated
                    ? current.map(row => row.name === updated.name ? updated : row)
                    : current.filter(row => row.name !== tool.name));
            } catch (error) {
                push({ tone: 'danger', title: `Could not update ${tool.name}`, description: error instanceof Error ? error.message : String(error) });
            } finally {
                setBusy(null);
            }
        }
    }, [selected, push]);

    /**
     * Fold a stored group policy into the group list. When the server withdrew
     * restricted grants, reload the tool rows so their Access and Status
     * columns stop showing grants that no longer exist.
     *
     * Kept synchronous and stable so it can be handed to the card directly.
     * An inline wrapper would be a new function on every render, and the
     * card's own memoized callbacks depend on it.
     *
     * @param policy - The stored policy.
     * @param withdrawn - How many restricted grants the server withdrew.
     */
    const handlePolicyChange = useCallback((policy: IMcpGroupPolicy, withdrawn: number): void => {
        setGroups(current => current.map(group => group.id === policy.groupId ? { ...group, policy } : group));
        if (withdrawn > 0) {
            void listMcpTools().then(
                setTools,
                /**
                 * Tell the admin the rows are out of date when the reload fails.
                 *
                 * @param error - Why the tool list could not be read.
                 */
                (error: unknown) => {
                    push({ tone: 'warning', title: 'Reload the page to see the withdrawn tools', description: error instanceof Error ? error.message : String(error) });
                }
            );
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
                Pick a user group, then switch on the tools its members may use. Only members of mcp-users can connect at
                all, so a tool granted to another group reaches the people in both. Tools that fail the MCP safety rules are
                restricted: they can never go to mcp-users, and go to another group only after you allow restricted tools for it.
                If a tool&apos;s capability changes after you grant it, it is hidden again until you grant it again.
            </p>

            {selected === null ? (
                <div className="alert">The user groups could not be loaded, so tools cannot be granted. Reload the page to try again.</div>
            ) : (
                <>
                    <Field label="Managing access for" className={styles.group_picker}>
                        <Select
                            value={selected.id}
                            onChange={
                                /**
                                 * Switch the group the protections card and the grant switches act on.
                                 *
                                 * @param event - The select's change event, carrying the chosen group id.
                                 */
                                event => setSelectedId(event.target.value)
                            }
                        >
                            {groups.map(group => (
                                <option key={group.id} value={group.id}>
                                    {group.isGateGroup ? `${group.name} (every MCP user)` : group.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <GroupPolicyCard
                        key={selected.id}
                        group={selected}
                        restrictedGrantCount={restrictedGrantCount}
                        onPolicyChange={handlePolicyChange}
                    />
                </>
            )}

            <Card padding="xs">
                <Table flush className={styles.tools_table}>
                    <Thead>
                        <Tr>
                            <Th>Tool</Th>
                            <Th>Capability</Th>
                            <Th>Access</Th>
                            <Th>Status{selected ? ` for ${selected.name}` : ''}</Th>
                            <Th>Grant</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {tools.map(tool => {
                            const grant = selected ? tool.grants.find(entry => entry.groupId === selected.id) : undefined;
                            const mayHold = selected !== null && groupMayHold(tool, selected);
                            // A grant the group may no longer hold shows as on, so
                            // the only action left, withdrawing it, is one click.
                            // Shown as off, the click would ask to grant again and
                            // the server would refuse.
                            const on = grant !== undefined && (!grant.stale || !mayHold);
                            const note = selected ? restrictionNote(tool, selected) : null;
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
                                    <Td data-label="Access">
                                        <div className={styles.badge_row}>
                                            {tool.grants.length === 0 && <span className={styles.tool_meta}>No groups</span>}
                                            {tool.grants.map(entry => (
                                                <Badge
                                                    key={entry.groupId}
                                                    tone={!groupNames.has(entry.groupId) || entry.stale ? 'warning' : entry.served ? 'info' : 'neutral'}
                                                    size="xs"
                                                >
                                                    {groupNames.get(entry.groupId) ?? `${entry.groupId} (deleted group)`}
                                                </Badge>
                                            ))}
                                        </div>
                                    </Td>
                                    <Td data-label="Status">
                                        {selected && (
                                            <Stack gap="sm">
                                                <div>{statusBadge(tool, selected, grant)}</div>
                                                {note && <span className={styles.tool_meta}>{note}</span>}
                                            </Stack>
                                        )}
                                    </Td>
                                    <Td data-label="Grant">
                                        <Switch
                                            on={on}
                                            onChange={next => { void toggle(tool, next); }}
                                            disabled={selected === null || busy === tool.name || (!grant && !mayHold)}
                                            aria-label={`${on ? 'Withdraw' : 'Grant'} ${tool.name} ${on ? 'from' : 'to'} ${selected?.name ?? 'this group'}`}
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
