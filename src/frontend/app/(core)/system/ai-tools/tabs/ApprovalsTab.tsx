'use client';

/**
 * @fileoverview Approvals tab — external/irreversible invocations the governor
 * parked for a human. Approve runs the call; reject discards it. Refetches on
 * the `ai-tools:approvals-changed` signal and reports the new count up via
 * `onChanged` so the header badge stays live.
 */

import { useEffect, useState, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { getSocket } from '../../../../../lib/socketClient';
import { listApprovals, approveInvocation, rejectInvocation, type IPendingApproval } from '../../../../../modules/ai-tools';
import styles from '../page.module.scss';

/** Truncate a JSON-stringified args object for inline preview. */
function preview(input: Record<string, unknown>): string {
    const text = JSON.stringify(input);
    return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

/**
 * Approvals tab content.
 *
 * @param props.onChanged - Called after load/approve/reject so the page header
 *                          pending badge refreshes.
 * @returns The tab.
 */
export function ApprovalsTab({ onChanged }: { onChanged: () => void }) {
    const [approvals, setApprovals] = useState<IPendingApproval[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const { push } = useToast();

    const load = useCallback(async () => {
        try {
            setApprovals(await listApprovals());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load approvals');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void load(); onChanged(); };
        socket.on('ai-tools:approvals-changed', handler);
        return () => { socket.off('ai-tools:approvals-changed', handler); };
    }, [load, onChanged]);

    const resolve = useCallback(async (id: string, action: 'approve' | 'reject') => {
        setBusyId(id);
        try {
            await (action === 'approve' ? approveInvocation(id) : rejectInvocation(id));
            push({ tone: action === 'approve' ? 'success' : 'info', title: action === 'approve' ? 'Approved' : 'Rejected' });
            await load();
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: `Failed to ${action}`, description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusyId(null);
        }
    }, [load, onChanged, push]);

    if (loading) {
        return <div className={styles.placeholder}>Loading approvals…</div>;
    }

    return (
        <Stack gap="md">
            {error && <div className="alert" role="alert">{error}</div>}
            {approvals.length === 0
                ? <div className={styles.placeholder}>No actions are awaiting approval.</div>
                : (
                    <div className="table-scroll">
                        <Table>
                            <Thead>
                                <Tr>
                                    <Th width="shrink">Parked</Th>
                                    <Th>Tool</Th>
                                    <Th width="shrink">Trigger</Th>
                                    <Th>Arguments</Th>
                                    <Th width="shrink">Decision</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {approvals.map(approval => (
                                    <Tr key={approval.id}>
                                        <Td muted><ClientTime date={approval.createdAt} format="datetime" /></Td>
                                        <Td>
                                            <div className={styles.tool_name}>{approval.toolName}</div>
                                            <div className={styles.tool_desc}>{approval.providerId}</div>
                                        </Td>
                                        <Td muted>{approval.context.triggerPath}</Td>
                                        <Td><span className={styles.mono}>{preview(approval.input)}</span></Td>
                                        <Td>
                                            <div className={styles.row_actions}>
                                                <Button variant="primary" size="sm" loading={busyId === approval.id} onClick={() => { void resolve(approval.id, 'approve'); }}>
                                                    <Check size={16} /> Approve
                                                </Button>
                                                <Button variant="danger" size="sm" disabled={busyId === approval.id} onClick={() => { void resolve(approval.id, 'reject'); }}>
                                                    <X size={16} /> Reject
                                                </Button>
                                            </div>
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </div>
                )}
        </Stack>
    );
}
