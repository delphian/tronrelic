'use client';

/**
 * @fileoverview Approvals tab — external/irreversible invocations the governor
 * parked for a human. Each row leads with its dominant risk class and opens a
 * slide-over holding the full arguments, capability, and trigger context, so the
 * decision is made against the whole payload rather than a truncated preview.
 * Approving a money-spending or unrecoverable action confirms first; a flooded
 * queue can be cleared with a bulk reject. Refetches on the
 * `ai-tools:approvals-changed` signal and reports the new count up via `onChanged`
 * so the header badge stays live.
 */

import { useEffect, useState, useCallback, type MouseEvent } from 'react';
import { Check, X } from 'lucide-react';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { SlideOver } from '../../../../../components/ui/SlideOver';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { ConfirmDialog } from '../../../../../components/ui/ConfirmDialog';
import { getSocket } from '../../../../../lib/socketClient';
import { listApprovals, approveInvocation, rejectInvocation, type IPendingApproval } from '../../../../../modules/ai-tools';
import { RiskChip } from '../components/RiskChip';
import { ApprovalDetailPanel } from '../components/ApprovalDetailPanel';
import styles from '../page.module.scss';

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
    const [bulkBusy, setBulkBusy] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const { push } = useToast();
    const { open, close } = useModal();

    const load = useCallback(async () => {
        try {
            const list = await listApprovals();
            setApprovals(list);
            // Drop any checked/selected ids that no longer exist so a resolved
            // hold never lingers in the selection or the open panel.
            const live = new Set(list.map(approval => approval.id));
            setChecked(previous => new Set([...previous].filter(id => live.has(id))));
            setSelectedId(previous => (previous && live.has(previous) ? previous : null));
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

    /**
     * Run or discard a single held action.
     *
     * @param id - The held request id.
     * @param action - Whether to approve (run) or reject (discard).
     */
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

    /**
     * Approve directly, no confirm. Used from the detail panel, where the full
     * arguments and the risk caution are already on screen — opening the panel
     * and approving there is itself the deliberate step (and avoids stacking a
     * modal over the open slide-over).
     *
     * @param approval - The held action to approve.
     */
    const approveNow = useCallback((approval: IPendingApproval) => {
        void resolve(approval.id, 'approve');
    }, [resolve]);

    /**
     * Approve from the compact row, where the arguments are not visible. A
     * money-spending or unrecoverable effect confirms first — those run
     * immediately and cannot be taken back, so a deliberate second step guards a
     * mis-click; a low-stakes hold approves directly.
     *
     * @param approval - The held action to approve.
     */
    const handleRowApprove = useCallback((approval: IPendingApproval) => {
        const dangerous = approval.capability?.spendsMoney === true || approval.capability?.reversible === false;
        if (!dangerous) {
            void resolve(approval.id, 'approve');
            return;
        }
        const modalId = open({
            title: 'Approve action',
            content: (
                <ConfirmDialog
                    label={approval.toolName}
                    confirmLabel="Approve & run"
                    message={<>Approving runs <strong>{approval.toolName}</strong> now. This effect cannot be undone. Continue?</>}
                    onConfirm={async () => { await resolve(approval.id, 'approve'); close(modalId); }}
                    onCancel={() => close(modalId)}
                />
            )
        });
    }, [resolve, open, close]);

    /**
     * Reject (discard) a held action without running it.
     *
     * @param approval - The held action to reject.
     */
    const handleReject = useCallback((approval: IPendingApproval) => {
        void resolve(approval.id, 'reject');
    }, [resolve]);

    /**
     * Reject every checked action after one confirmation — the escape hatch for a
     * queue flooded by a looping or injected agent.
     */
    const handleBulkReject = useCallback(() => {
        const ids = [...checked];
        if (ids.length === 0) {
            return;
        }
        const modalId = open({
            title: 'Reject selected',
            content: (
                <ConfirmDialog
                    label={`${ids.length} actions`}
                    confirmLabel={`Reject ${ids.length}`}
                    message={<>Reject <strong>{ids.length}</strong> parked action{ids.length === 1 ? '' : 's'}? They will not run.</>}
                    onConfirm={async () => {
                        setBulkBusy(true);
                        try {
                            for (const id of ids) {
                                await rejectInvocation(id);
                            }
                            push({ tone: 'info', title: `Rejected ${ids.length}` });
                            await load();
                            onChanged();
                        } catch (err) {
                            push({ tone: 'danger', title: 'Bulk reject failed', description: err instanceof Error ? err.message : String(err) });
                        } finally {
                            setBulkBusy(false);
                            close(modalId);
                        }
                    }}
                    onCancel={() => close(modalId)}
                />
            )
        });
    }, [checked, open, close, load, onChanged, push]);

    /**
     * Toggle one row's checkbox without opening its detail panel.
     *
     * @param id - The held request id to toggle.
     */
    const toggleOne = useCallback((id: string) => {
        setChecked(previous => {
            const next = new Set(previous);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    if (loading) {
        return <div className={styles.placeholder}>Loading approvals…</div>;
    }

    const allChecked = approvals.length > 0 && approvals.every(approval => checked.has(approval.id));
    const selectedApproval = selectedId ? approvals.find(approval => approval.id === selectedId) ?? null : null;

    /** Toggle every row's checkbox at once. */
    const toggleAll = () => {
        setChecked(allChecked ? new Set() : new Set(approvals.map(approval => approval.id)));
    };

    /** Keep a checkbox/decision cell click from opening the row's detail panel. */
    const stopCellClick = (event: MouseEvent<HTMLTableCellElement>) => {
        event.stopPropagation();
    };

    return (
        <Stack gap="md">
            {error && <div className="alert" role="alert">{error}</div>}
            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                Approving runs the action now, separately from the chat that requested it: that turn already ended — the
                agent was told the action was pending and continued without the result, so approving neither resumes the
                conversation nor returns the result to it. Holds from scheduled or programmatic prompts have no requester
                waiting at all, so approve only when the side effect itself is the goal.
            </p>
            {approvals.length === 0
                ? <div className={styles.placeholder}>No actions are awaiting approval.</div>
                : (
                    <>
                        {checked.size > 0 && (
                            <div className={styles.bulk_bar}>
                                <span className="text-muted" style={{ fontSize: 'var(--font-size-body-sm)' }}>
                                    {checked.size} selected
                                </span>
                                <Button variant="danger" size="sm" loading={bulkBusy} onClick={handleBulkReject}>
                                    <X size={16} /> Reject selected
                                </Button>
                            </div>
                        )}
                        <div className="table-scroll">
                            <Table>
                                <Thead>
                                    <Tr>
                                        <Th width="shrink">
                                            <input
                                                type="checkbox"
                                                checked={allChecked}
                                                onChange={toggleAll}
                                                aria-label="Select all approvals"
                                            />
                                        </Th>
                                        <Th width="shrink">Parked</Th>
                                        <Th width="shrink">Risk</Th>
                                        <Th>Tool</Th>
                                        <Th width="shrink">Trigger</Th>
                                        <Th width="shrink">Decision</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {approvals.map(approval => (
                                        <Tr
                                            key={approval.id}
                                            className={styles.tool_row}
                                            onClick={() => setSelectedId(approval.id)}
                                        >
                                            <Td onClick={stopCellClick}>
                                                <input
                                                    type="checkbox"
                                                    checked={checked.has(approval.id)}
                                                    onChange={() => toggleOne(approval.id)}
                                                    aria-label={`Select ${approval.toolName}`}
                                                />
                                            </Td>
                                            <Td muted><ClientTime date={approval.createdAt} format="datetime" /></Td>
                                            <Td><RiskChip capability={approval.capability} /></Td>
                                            <Td>
                                                <div className={styles.tool_name}>{approval.toolName}</div>
                                                <div className={styles.tool_desc}>{approval.providerId}</div>
                                            </Td>
                                            <Td muted>{approval.context.triggerPath}</Td>
                                            <Td onClick={stopCellClick}>
                                                <div className={styles.row_actions}>
                                                    <Button variant="primary" size="sm" loading={busyId === approval.id} onClick={() => handleRowApprove(approval)}>
                                                        <Check size={16} /> Approve
                                                    </Button>
                                                    <Button variant="danger" size="sm" disabled={busyId === approval.id} onClick={() => handleReject(approval)}>
                                                        <X size={16} /> Reject
                                                    </Button>
                                                </div>
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        </div>
                    </>
                )}

            <SlideOver
                open={selectedApproval !== null}
                onClose={() => setSelectedId(null)}
                label={selectedApproval ? `Approval ${selectedApproval.toolName}` : undefined}
                title={selectedApproval ? <span className={styles.tool_name}>{selectedApproval.toolName}</span> : null}
            >
                {selectedApproval && (
                    <ApprovalDetailPanel
                        approval={selectedApproval}
                        busy={busyId === selectedApproval.id}
                        onApprove={approveNow}
                        onReject={handleReject}
                    />
                )}
            </SlideOver>
        </Stack>
    );
}
