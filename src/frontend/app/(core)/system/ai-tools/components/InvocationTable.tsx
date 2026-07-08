'use client';

/**
 * @fileoverview The invocation audit feed's row table, extracted so the Activity
 * tab (global feed) and the Query tab's per-conversation "tools used" feed render
 * an identical surface — same columns, same status colouring, same click-to-open
 * behaviour. Keeping one table means a column added here appears on both feeds and
 * the two can never drift. The parent owns selection state and the detail
 * slide-over; this component only lists rows and reports a click.
 */

import type { IToolInvocationRecord } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { statusTone } from './InvocationDetailPanel';
import styles from '../page.module.scss';

/**
 * Render the invocation audit rows for a set of records. The row is deliberately
 * terminal-triage only (time, tool, provider, actor, trigger, status, duration);
 * the full record lives behind the click, in the caller's slide-over.
 *
 * @param props.records - The audit records to list, already ordered by the caller.
 * @param props.onSelect - Invoked with the clicked record so the caller can open
 *   its detail panel — selection lives in the parent so the same detail slide-over
 *   serves whatever surface hosts the table.
 * @returns The scrollable rows table.
 */
export function InvocationTable({ records, onSelect }: {
    records: IToolInvocationRecord[];
    onSelect: (record: IToolInvocationRecord) => void;
}) {
    return (
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
                    {records.map(record => (
                        <Tr
                            key={record.id}
                            className={styles.tool_row}
                            hasError={record.status === 'error'}
                            onClick={() => onSelect(record)}
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
    );
}
