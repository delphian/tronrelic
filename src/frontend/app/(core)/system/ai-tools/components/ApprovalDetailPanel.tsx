'use client';

/**
 * @fileoverview Slide-over body for one parked approval — the detail half of the
 * Approvals queue. Approving runs an irreversible/external/paid effect *now*, so
 * the decision must be made against the full picture, not a truncated argument
 * preview: this panel shows the dominant risk class and full capability badges, a
 * caution when the effect spends money or cannot be undone, the trigger context,
 * and the complete pretty-printed arguments. Approve/Reject live here beside that
 * payload; the parent owns the confirm-for-dangerous and close behaviour.
 */

import type { IPendingApproval } from '../../../../../modules/ai-tools';
import { AlertTriangle, Check, X } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { CapabilityBadges } from './CapabilityBadges';
import { RiskChip } from './RiskChip';
import styles from '../page.module.scss';

/**
 * The detail panel for one parked approval, rendered inside the SlideOver body.
 *
 * @param props.approval - The held invocation awaiting a decision.
 * @param props.busy - Whether this approval's approve/reject is in flight.
 * @param props.onApprove - Runs the held action (parent confirms dangerous classes first).
 * @param props.onReject - Discards the held action (parent confirms first).
 * @returns The approval detail body with in-panel actions.
 */
export function ApprovalDetailPanel({ approval, busy, onApprove, onReject }: {
    approval: IPendingApproval;
    busy: boolean;
    onApprove: (approval: IPendingApproval) => void;
    onReject: (approval: IPendingApproval) => void;
}) {
    const capability = approval.capability;
    const actor = approval.context.actor;
    const actorLabel = `${actor.kind}${actor.id ? ` · ${actor.id}` : ''}`;
    // A money-spending or unrecoverable effect deserves an explicit caution above
    // the run button, separate from the always-present capability badges.
    const highStakes = capability?.spendsMoney === true || capability?.reversible === false;

    return (
        <div className={styles.detail}>
            <div className={styles.detail_meta}>
                <div className={styles.detail_meta_row}>
                    <span className="text-muted">{approval.providerId}</span>
                    <RiskChip capability={capability} />
                </div>
                <CapabilityBadges capability={capability} />
            </div>

            {highStakes && (
                <div className={styles.detail_caution}>
                    <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0 }} />
                    <span>
                        Approving runs this effect immediately and it
                        {capability?.reversible === false ? ' cannot be undone' : ''}
                        {capability?.spendsMoney ? ' spends money' : ''}. Review the arguments below before approving.
                    </span>
                </div>
            )}

            <div className={styles.detail_section}>
                <span className={styles.detail_section_title}>Context</span>
                <dl className={styles.kv}>
                    <dt className={styles.kv_label}>Trigger</dt>
                    <dd className={styles.kv_value}>{approval.context.triggerPath}</dd>
                    <dt className={styles.kv_label}>Actor</dt>
                    <dd className={styles.kv_value}>{actorLabel}</dd>
                    <dt className={styles.kv_label}>AI provider</dt>
                    <dd className={styles.kv_value}>{approval.context.aiProviderId}</dd>
                    {approval.context.callerPluginId && (
                        <>
                            <dt className={styles.kv_label}>Caller</dt>
                            <dd className={styles.kv_value}>{approval.context.callerPluginId}</dd>
                        </>
                    )}
                    {approval.context.endUser && (
                        <>
                            <dt className={styles.kv_label}>End user</dt>
                            <dd className={styles.kv_value}>{approval.context.endUser.userId}</dd>
                        </>
                    )}
                    <dt className={styles.kv_label}>Parked</dt>
                    <dd className={styles.kv_value}><ClientTime date={approval.createdAt} format="datetime" /></dd>
                </dl>
            </div>

            <div className={styles.detail_section}>
                <span className={styles.detail_section_title}>Arguments</span>
                <pre className={styles.args_block}>{JSON.stringify(approval.input, null, 2)}</pre>
            </div>

            <div className={styles.detail_actions}>
                <Button
                    variant="primary"
                    size="md"
                    loading={busy}
                    onClick={() => onApprove(approval)}
                    aria-label={`Approve ${approval.toolName}`}
                >
                    <Check size={18} /> Approve
                </Button>
                <Button
                    variant="danger"
                    size="md"
                    disabled={busy}
                    onClick={() => onReject(approval)}
                    aria-label={`Reject ${approval.toolName}`}
                >
                    <X size={18} /> Reject
                </Button>
            </div>
        </div>
    );
}
