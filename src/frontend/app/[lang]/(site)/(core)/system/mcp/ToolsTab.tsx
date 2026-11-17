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
 * for it. The virtual Anonymous group, which stands for callers of the public
 * endpoint, may be granted only tools whose data is marked public. A tool
 * whose capability changed after it was granted is flagged and is not served
 * until granted again.
 *
 * Around a hundred tools are registered, so a name search and a status filter
 * sit beside the group picker and narrow the list in the browser; the whole
 * list is already on the page, so filtering it needs no request.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { IMcpGroup, IMcpGroupPolicy, IMcpServerDescriptionStatus, IMcpToolExposure, IMcpToolGrant } from '@/types';
import { mcpGroupMayHoldTool } from '@/types';
import { Card } from '../../../../../../components/ui/Card';
import { Stack } from '../../../../../../components/layout';
import { Badge, type BadgeTone } from '../../../../../../components/ui/Badge';
import { Field } from '../../../../../../components/ui/Field';
import { Input } from '../../../../../../components/ui/Input';
import { Select } from '../../../../../../components/ui/Select';
import { Switch } from '../../../../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import { listMcpTools, setMcpToolExposure } from '../../../../../../modules/mcp';
import { CapabilityBadges } from '../ai-tools/components/CapabilityBadges';
import { GroupPolicyCard } from './GroupPolicyCard';
import { ServerDescriptionCard } from './ServerDescriptionCard';
import styles from './page.module.scss';

/**
 * Props for {@link ToolsTab}.
 */
interface IToolsTabProps {
    /** SSR-fetched tool rows. */
    initialTools: IMcpToolExposure[];
    /** SSR-fetched user groups with their MCP settings, mcp-users first. */
    initialGroups: IMcpGroup[];
    /**
     * The group to manage on arrival, from the page's `?group=` deep link.
     * An unknown id falls back to the first group.
     */
    initialGroupId?: string;
    /** Called with every row after a change, so the overview counts update. */
    onToolsChanged: (tools: IMcpToolExposure[]) => void;
    /**
     * The server description and whether it matches the anonymous grants,
     * kept current by the parent after each change; null when the status
     * could not be loaded.
     */
    serverDescription: IMcpServerDescriptionStatus | null;
}

/**
 * Decide whether a group may hold a grant for a tool right now: true when the
 * tool passes the safety rules, or the group allows restricted tools. The
 * Anonymous group may hold only tools that pass its stricter floor (public
 * data only), whatever its policy says.
 */
function groupMayHold(tool: IMcpToolExposure, group: IMcpGroup): boolean {
    return group.isAnonymous
        ? tool.anonymousIneligibleReason === null
        : mcpGroupMayHoldTool(tool.restrictedReason !== null, group.policy);
}

/**
 * The kinds of state a tool can be in for the managed group. The status badge
 * names the exact state, and the status filter selects by kind, so one badge
 * wording per kind is not needed and the filter stays short.
 *
 * - `served`: granted, and served to the group's members.
 * - `blocked`: granted, but not served for a reason other than a changed
 *   capability (the group may no longer hold it, is switched off, or the tool
 *   is disabled in the registry).
 * - `stale`: granted, but the tool's capability changed since, so it waits to
 *   be granted again.
 * - `hidden`: not granted, and could be.
 * - `restricted`: not granted, and the group may not hold it.
 */
type ToolStatusKind = 'served' | 'blocked' | 'stale' | 'hidden' | 'restricted';

/** The status filter's value: one kind, or every tool. */
type ToolStatusFilter = ToolStatusKind | 'all';

/** A tool's state for the managed group: its kind, and the badge that names it. */
interface IToolStatus {
    /** Which kind of state, for the status filter. */
    kind: ToolStatusKind;
    /** The badge text. */
    label: string;
    /** The badge colour. */
    tone: BadgeTone;
}

/**
 * Work out a tool's state for the managed group. The status column and the
 * status filter both read it, so a tool is always listed under the filter
 * whose badge it shows.
 *
 * @param tool - The tool row.
 * @param group - The group being managed.
 * @param grant - The group's grant for the tool, when it has one.
 * @returns The state's kind and its badge.
 */
function describeStatus(tool: IMcpToolExposure, group: IMcpGroup, grant: IMcpToolGrant | undefined): IToolStatus {
    const mayHold = groupMayHold(tool, group);
    let status: IToolStatus = { kind: 'hidden', label: 'Hidden', tone: 'neutral' };
    // A grant the group may no longer hold is reported before staleness: its
    // switch shows as on so the only action is to withdraw it, and "grant
    // again" would point the admin at a request the server refuses.
    if (!grant && !mayHold) {
        status = { kind: 'restricted', label: group.isAnonymous ? 'Not public' : 'Restricted', tone: 'neutral' };
    } else if (grant && !mayHold) {
        status = { kind: 'blocked', label: group.isAnonymous ? 'Blocked — not public' : 'Blocked — restricted', tone: 'warning' };
    } else if (grant && !group.policy.enabled) {
        // The switch beside it shows the tool is granted, so the badge only
        // says why it is not served; a longer badge widens the whole column.
        status = { kind: 'blocked', label: 'Group switched off', tone: 'warning' };
    } else if (grant?.stale) {
        status = { kind: 'stale', label: 'Changed — grant again', tone: 'warning' };
    } else if (grant && !tool.enabledInRegistry) {
        status = { kind: 'blocked', label: 'Disabled in registry', tone: 'warning' };
    } else if (grant?.served) {
        const restricted = tool.restrictedReason !== null;
        status = { kind: 'served', label: restricted ? 'Served — restricted' : 'Served', tone: restricted ? 'danger' : 'success' };
    }
    return status;
}

/**
 * Build the status filter's choices for the managed group. The restricted
 * kind takes the group's own word for it, so Anonymous reads "Not public"
 * as its badges do.
 *
 * @param group - The group being managed, or null when the groups could not be loaded.
 * @returns The options, "Any status" first.
 */
function statusFilterOptions(group: IMcpGroup | null): Array<{ value: ToolStatusFilter; label: string }> {
    return [
        { value: 'all', label: 'Any status' },
        { value: 'served', label: 'Served' },
        { value: 'blocked', label: 'Granted, not served' },
        { value: 'stale', label: 'Changed since granted' },
        { value: 'hidden', label: 'Hidden' },
        { value: 'restricted', label: group?.isAnonymous ? 'Not public' : 'Restricted' }
    ];
}

/** Narrow a select's value to a status filter, falling back to every tool. */
function toStatusFilter(value: string): ToolStatusFilter {
    const known: ToolStatusFilter[] = ['all', 'served', 'blocked', 'stale', 'hidden', 'restricted'];
    return known.find(option => option === value) ?? 'all';
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
    // The anonymous reason already says what Anonymous may hold, and it shows
    // on most rows while Anonymous is managed, so it is not followed by a
    // second sentence repeating it.
    if (group.isAnonymous && tool.anonymousIneligibleReason !== null) {
        note = tool.anonymousIneligibleReason;
    } else if (tool.restrictedReason !== null && group.isGateGroup) {
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
export function ToolsTab({ initialTools, initialGroups, initialGroupId, onToolsChanged, serverDescription }: IToolsTabProps) {
    const [tools, setTools] = useState<IMcpToolExposure[]>(initialTools);
    const [groups, setGroups] = useState<IMcpGroup[]>(initialGroups);
    const [selectedId, setSelectedId] = useState<string>(
        initialGroups.find(group => group.id === initialGroupId)?.id ?? initialGroups[0]?.id ?? ''
    );
    const [busy, setBusy] = useState<string | null>(null);
    const [nameFilter, setNameFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState<ToolStatusFilter>('all');
    const { push } = useToast();

    const selected = groups.find(group => group.id === selectedId) ?? groups[0] ?? null;
    const groupNames = useMemo(() => new Map(groups.map(group => [group.id, group.name])), [groups]);
    const restrictedGrantCount = selected
        ? tools.filter(tool => tool.restrictedReason !== null && tool.grants.some(grant => grant.groupId === selected.id)).length
        : 0;

    /**
     * The rows the filters let through. A name matches anywhere in the tool's
     * name or its owning module or plugin, ignoring case, so "whale" finds
     * every whale-alerts tool. Without a managed group there is no status to
     * filter on, so only the name applies.
     */
    const visibleTools = useMemo(() => {
        const needle = nameFilter.trim().toLowerCase();
        return tools.filter(tool => {
            const nameMatches = needle === '' || tool.name.toLowerCase().includes(needle) || tool.provider.toLowerCase().includes(needle);
            const grant = selected ? tool.grants.find(entry => entry.groupId === selected.id) : undefined;
            const statusMatches = statusFilter === 'all' || selected === null || describeStatus(tool, selected, grant).kind === statusFilter;
            return nameMatches && statusMatches;
        });
    }, [tools, nameFilter, statusFilter, selected]);

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
     * Manage another group and write it into the address, so a reload, a
     * bookmark, or a link pasted to another admin opens on the same group.
     *
     * @param groupId - The group chosen in the picker.
     */
    const selectGroup = useCallback((groupId: string): void => {
        setSelectedId(groupId);
        window.history.replaceState(null, '', `/system/mcp?tab=tools&group=${encodeURIComponent(groupId)}`);
    }, []);

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
     * stay accurate. Runs after the state commits
     * rather than inside the state updater, which must stay free of side effects.
     */
    useEffect(() => {
        onToolsChanged(tools);
    }, [tools, onToolsChanged]);

    return (
        <Stack gap="md">
            <p className={styles.intro}>
                Pick a group, then switch on the tools it may use. Anonymous stands for anyone calling without signing in, and
                only tools whose data is public can go to it. Every account is in mcp-users, so a tool granted there reaches
                every signed-in member; grant to a narrower group to reach only its members. Tools that fail the MCP safety
                rules are restricted: they never go to mcp-users or Anonymous, and go to another group only after you allow
                restricted tools for it. If a tool&apos;s capability changes after you grant it, it is hidden until you grant it
                again. Hover a capability badge to see what it means.
            </p>

            {selected === null && (
                <div className="alert">The user groups could not be loaded, so tools cannot be granted. Reload the page to try again.</div>
            )}

            {/* The group picker chooses what the protections card and the
                Status and Grant columns act on; the search and the status
                filter only narrow the list below. */}
            <div className={styles.tool_filters}>
                {selected !== null && (
                    <Field label="Managing access for" className={styles.tool_filter_group}>
                        <Select
                            value={selected.id}
                            onChange={
                                event => selectGroup(event.target.value)
                            }
                        >
                            {/* The Anonymous group's name already says who it
                                is, so only mcp-users is explained here. */}
                            {groups.map(group => (
                                <option key={group.id} value={group.id}>
                                    {group.isGateGroup ? `${group.name} (every signed-in account)` : group.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                )}
                <Field label="Find a tool" className={styles.tool_filter_search}>
                    <Input
                        type="search"
                        value={nameFilter}
                        onChange={event => setNameFilter(event.target.value)}
                        placeholder="Name or module"
                    />
                </Field>
                {selected !== null && (
                    <Field label={`Status for ${selected.name}`} className={styles.tool_filter_status}>
                        <Select
                            value={statusFilter}
                            onChange={event => setStatusFilter(toStatusFilter(event.target.value))}
                        >
                            {statusFilterOptions(selected).map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </Field>
                )}
            </div>

            {selected !== null && (
                <>
                    <GroupPolicyCard
                        key={selected.id}
                        group={selected}
                        restrictedGrantCount={restrictedGrantCount}
                        onPolicyChange={handlePolicyChange}
                    />
                    {/* The description names what works without an account, so it
                        sits beside the Anonymous grants it has to match. */}
                    {selected.isAnonymous && serverDescription && <ServerDescriptionCard status={serverDescription} />}
                </>
            )}

            <Card padding="xs">
                {/* Status and Grant hold one badge and a switch, so they shrink
                    to them and the other columns take the spare width. The
                    capability badges may wrap: a restricted tool can carry five,
                    which on one line would take half a tablet's width. The table
                    then fits a tablet, and rows stack only at phone width, each
                    headed by the tool's name. */}
                <Table flush stackAt="mobile">
                    <Thead>
                        <Tr>
                            <Th>Tool</Th>
                            <Th>Capability</Th>
                            <Th>Access</Th>
                            {/* Not "Status for <group>": the column keeps its
                                heading on one line, and a long group name there
                                widened it past the badges. The picker and the
                                status filter above already name the group. */}
                            <Th width="shrink">Status</Th>
                            <Th width="shrink">Grant</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {visibleTools.length === 0 && (
                            <Tr>
                                <Td colSpan={5} muted>No tools match these filters.</Td>
                            </Tr>
                        )}
                        {visibleTools.map(tool => {
                            const grant = selected ? tool.grants.find(entry => entry.groupId === selected.id) : undefined;
                            const mayHold = selected !== null && groupMayHold(tool, selected);
                            // A grant the group may no longer hold shows as on, so
                            // the only action left, withdrawing it, is one click.
                            // Shown as off, the click would ask to grant again and
                            // the server would refuse.
                            const on = grant !== undefined && (!grant.stale || !mayHold);
                            const note = selected ? restrictionNote(tool, selected) : null;
                            const status = selected ? describeStatus(tool, selected, grant) : null;
                            return (
                                <Tr key={tool.name}>
                                    {/* The reason a tool cannot be granted sits under
                                        its name, because the Status column is kept
                                        to one line. */}
                                    <Td>
                                        <div className={styles.tool_name}>{tool.name}</div>
                                        <div className={styles.tool_meta}>{tool.provider}</div>
                                        {note && <div className={styles.tool_note}>{note}</div>}
                                    </Td>
                                    <Td label="Capability">
                                        {/* The shared badges explain themselves on hover and
                                            match the Activity tab's call detail. */}
                                        <CapabilityBadges capability={tool.capability} />
                                    </Td>
                                    <Td label="Access">
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
                                    <Td label="Status">
                                        {status && <Badge tone={status.tone} size="sm">{status.label}</Badge>}
                                    </Td>
                                    {/* No label: the switch ends the stacked entry
                                        and names itself through its aria-label. */}
                                    <Td>
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
