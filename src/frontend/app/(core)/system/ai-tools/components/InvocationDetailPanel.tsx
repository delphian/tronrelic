'use client';

/**
 * @fileoverview Slide-over body for one audit record — the detail half of the
 * Activity feed. The feed row is terminal triage (tool, status, duration); this
 * panel surfaces everything the `IToolInvocationRecord` actually captured but the
 * row hides: the capability class at invocation, the redacted arguments, the
 * result digest, the sanitized and raw error bodies (admin-only forensics), the
 * cost, the end-user principal, the correlation ids, and the untrusted-content
 * screen verdict. An auditor reconstructing "what did this call do, and what came
 * back" reads it here rather than from source.
 */

import type { IToolInvocationRecord, ToolInvocationStatus } from '@/types';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { CapabilityBadges } from './CapabilityBadges';
import styles from '../page.module.scss';

/**
 * Map an invocation status to a badge tone. Exported so the Activity feed row and
 * this panel colour a status identically.
 *
 * @param status - The terminal invocation status.
 * @returns The badge tone for that status.
 */
export function statusTone(status: ToolInvocationStatus): 'success' | 'warning' | 'danger' | 'info' {
    switch (status) {
        case 'ok': return 'success';
        case 'denied': return 'warning';
        case 'pending-approval': return 'info';
        default: return 'danger';
    }
}

/**
 * The detail panel for one invocation record, rendered inside the SlideOver body.
 *
 * @param props.record - The audit record to expand.
 * @returns The record detail body.
 */
export function InvocationDetailPanel({ record }: { record: IToolInvocationRecord }) {
    const actorLabel = `${record.actor.kind}${record.actor.id ? ` · ${record.actor.id}` : ''}`;

    return (
        <div className={styles.detail}>
            <div className={styles.detail_meta}>
                <div className={styles.detail_meta_row}>
                    <span className="text-muted">{record.providerId}</span>
                    <Badge tone={statusTone(record.status)}>{record.status}</Badge>
                </div>
                <CapabilityBadges capability={record.capability} />
            </div>

            <div className={styles.detail_section}>
                <span className={styles.detail_section_title}>Invocation</span>
                <dl className={styles.kv}>
                    <dt className={styles.kv_label}>AI provider</dt>
                    <dd className={styles.kv_value}>{record.aiProviderId}</dd>
                    <dt className={styles.kv_label}>Actor</dt>
                    <dd className={styles.kv_value}>{actorLabel}</dd>
                    <dt className={styles.kv_label}>Trigger</dt>
                    <dd className={styles.kv_value}>{record.triggerPath}</dd>
                    {record.endUserId && (
                        <>
                            <dt className={styles.kv_label}>End user</dt>
                            <dd className={styles.kv_value}>{record.endUserId}</dd>
                        </>
                    )}
                    <dt className={styles.kv_label}>Duration</dt>
                    <dd className={styles.kv_value}>{record.durationMs}ms</dd>
                    {record.costUsd !== undefined && (
                        <>
                            <dt className={styles.kv_label}>Cost</dt>
                            <dd className={styles.kv_value}>≈ ${record.costUsd.toFixed(4)}</dd>
                        </>
                    )}
                    <dt className={styles.kv_label}>Time</dt>
                    <dd className={styles.kv_value}><ClientTime date={record.createdAt} format="datetime" /></dd>
                    {record.conversationId && (
                        <>
                            <dt className={styles.kv_label}>Conversation</dt>
                            <dd className={styles.kv_value}>{record.conversationId}</dd>
                        </>
                    )}
                    {record.queryId && (
                        <>
                            <dt className={styles.kv_label}>Query</dt>
                            <dd className={styles.kv_value}>{record.queryId}</dd>
                        </>
                    )}
                </dl>
            </div>

            <div className={styles.detail_section}>
                <span className={styles.detail_section_title}>Arguments</span>
                <p className="text-subtle" style={{ margin: 0, fontSize: 'var(--font-size-caption)' }}>
                    Redacted by the tool&apos;s declared sensitivity.
                </p>
                <pre className={styles.args_block}>{JSON.stringify(record.input, null, 2)}</pre>
            </div>

            <div className={styles.detail_section}>
                <span className={styles.detail_section_title}>Result</span>
                <p className={styles.kv_value} style={{ margin: 0 }}>
                    {record.resultDigest ?? 'No result preview stored.'}
                </p>
            </div>

            {(record.error || record.errorRaw) && (
                <div className={styles.detail_section}>
                    <span className={styles.detail_section_title}>Error</span>
                    <div className={styles.detail_error}>
                        {record.error && <span>{record.error}</span>}
                        {record.errorRaw && <span className={styles.mono}>{record.errorRaw}</span>}
                    </div>
                </div>
            )}

            {record.screen && (
                <div className={styles.detail_section}>
                    <span className={styles.detail_section_title}>Untrusted-content screen</span>
                    <dl className={styles.kv}>
                        <dt className={styles.kv_label}>Verdict</dt>
                        <dd className={styles.kv_value}>
                            <Badge tone={record.screen.flagged ? 'danger' : 'success'}>
                                {record.screen.flagged ? 'withheld' : 'passed'}
                            </Badge>
                        </dd>
                        {record.screen.reason && (
                            <>
                                <dt className={styles.kv_label}>Reason</dt>
                                <dd className={styles.kv_value}>{record.screen.reason}</dd>
                            </>
                        )}
                    </dl>
                </div>
            )}
        </div>
    );
}
