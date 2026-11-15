'use client';

/**
 * @fileoverview The invocation audit feed's row table, extracted so the Activity
 * tab (global feed) and the Query tab's per-conversation "tools used" feed render
 * an identical surface — same columns, same status colouring, same click-to-open
 * behaviour. Keeping one table means a column added here appears on both feeds and
 * the two can never drift. The parent owns selection state and the detail
 * slide-over; this component only lists rows and reports a click.
 *
 * Two column sets. The general feed shows who drove each call and how it was
 * triggered. A feed of MCP calls only, as on /system/mcp, swaps the provider and
 * trigger columns, which would say `mcp` on every row, for the caller's group
 * and client, which are what an admin scans MCP traffic for. Callers are named
 * by email address where the endpoint supplied one.
 *
 * Seven columns do not fit a tablet, so the table uses the shared Table's
 * `stackAt="tablet"`. Stacked, the time and the tool name share the entry's
 * first line and the remaining values are named beneath them.
 */

import type { IToolInvocationRecord } from '@/types';
import { Badge } from '../../../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../../components/ui/Table';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import { statusTone } from './InvocationDetailPanel';
import { describeCaller } from './describeCaller';
import { invocationStatusText } from './invocationStatusText';
import styles from '../page.module.scss';

/**
 * Props for {@link InvocationTable}.
 */
interface IInvocationTableProps {
    /** The audit records to list, already ordered by the caller. */
    records: IToolInvocationRecord[];

    /**
     * Invoked with the clicked record so the caller can open its detail panel.
     * Selection lives in the parent so the same detail slide-over serves
     * whatever surface hosts the table.
     */
    onSelect: (record: IToolInvocationRecord) => void;

    /** Email addresses keyed by user id, so callers are named rather than shown as ids. */
    userLabels?: Readonly<Record<string, string>>;

    /**
     * Show the columns for a feed of MCP calls only: caller, group, and client
     * instead of provider, actor, and trigger.
     */
    mcpColumns?: boolean;
}

/**
 * Render the invocation audit rows for a set of records. The row is for
 * scanning only; the full record lives behind the click, in the caller's
 * slide-over.
 *
 * @param props - {@link IInvocationTableProps}.
 * @returns The rows table, stacked into labelled entries at tablet width and below.
 */
export function InvocationTable({ records, onSelect, userLabels = {}, mcpColumns = false }: IInvocationTableProps) {
    return (
        <Table stackAt="tablet">
            <Thead>
                <Tr>
                    <Th width="shrink" className={styles.col_time}>Time</Th>
                    <Th>Tool</Th>
                    <Th>Caller</Th>
                    {mcpColumns ? (
                        <>
                            <Th width="shrink">Group</Th>
                            <Th width="shrink">Client</Th>
                        </>
                    ) : (
                        <>
                            <Th width="shrink">AI Provider</Th>
                            <Th width="shrink">Trigger</Th>
                        </>
                    )}
                    <Th width="shrink">Status</Th>
                    <Th width="shrink">Duration</Th>
                </Tr>
            </Thead>
            <Tbody>
                {records.map(record => {
                    const caller = describeCaller(record, userLabels);
                    return (
                        <Tr
                            key={record.id}
                            className={styles.tool_row}
                            hasError={record.status === 'error'}
                            onClick={() => onSelect(record)}
                        >
                            {/* Time and tool are unlabelled so, stacked, they share the
                                entry's first line as its heading. */}
                            <Td muted className={styles.col_time}><ClientTime date={record.createdAt} format="datetime" /></Td>
                            <Td>
                                <button
                                    type="button"
                                    className={styles.tool_name_button}
                                    onClick={(event) => { event.stopPropagation(); onSelect(record); }}
                                >
                                    {record.toolName}
                                </button>
                            </Td>
                            <Td label="Caller">
                                <span className={styles.caller_cell}>{caller.primary}</span>
                                <span className={styles.caller_kind}>{caller.kind}</span>
                            </Td>
                            {mcpColumns ? (
                                <>
                                    <Td muted label="Group">{record.origin?.chargedGroupId ?? '—'}</Td>
                                    <Td muted label="Client">{record.origin?.clientName ?? '—'}</Td>
                                </>
                            ) : (
                                <>
                                    <Td muted label="AI Provider">{record.aiProviderId}</Td>
                                    <Td muted label="Trigger">{record.triggerPath}</Td>
                                </>
                            )}
                            <Td label="Status">
                                <Badge tone={statusTone(record.status)}>{invocationStatusText[record.status].label}</Badge>
                            </Td>
                            <Td muted label="Duration">{record.durationMs.toLocaleString('en-US')} ms</Td>
                        </Tr>
                    );
                })}
            </Tbody>
        </Table>
    );
}
