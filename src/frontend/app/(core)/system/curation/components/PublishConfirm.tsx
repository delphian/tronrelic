'use client';

/**
 * @fileoverview The confirmation shown before an approval that publishes to one
 * or more public destinations. Naming exactly which destinations will receive
 * the content, and saying it cannot be undone, turns a reflex click into a
 * decision. Focus starts on Cancel so a stray Enter never takes the path that
 * cannot be reversed.
 */

import { AlertTriangle, Globe } from 'lucide-react';
import { Stack } from '../../../../../components/layout';
import { Badge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import type { ICurationEligibleSink } from '../../../../../modules/curation';
import { countLabel } from './countLabel';
import styles from './CurationModals.module.scss';

/** Props for {@link PublishConfirm}. */
export interface IPublishConfirmProps {
    /** The selected public destinations to name. */
    channels: ICurationEligibleSink[];
    /** Go ahead with the approval and publish. */
    onConfirm: () => void;
    /** Close without approving, back to the review sheet. */
    onCancel: () => void;
}

/**
 * The public-publish confirmation body.
 *
 * @param props - See {@link IPublishConfirmProps}.
 * @returns The warning, the named destinations, and the two choices.
 */
export function PublishConfirm({ channels, onConfirm, onCancel }: IPublishConfirmProps) {
    return (
        <Stack gap="md">
            <p className={styles.warning} role="alert">
                <AlertTriangle size={18} aria-hidden="true" className={styles.warning_icon} />
                <span>Approving publishes to these destinations right away. It can&apos;t be undone.</span>
            </p>
            <ul className={styles.list}>
                {channels.map(channel => (
                    <li key={channel.sinkId} className={styles.list_item}>
                        <Globe size={14} aria-hidden="true" />
                        <span className={styles.list_label}>{channel.label ?? channel.sinkId}</span>
                        <Badge tone="warning" size="xs">{channel.reach.egress}/{channel.reach.audience}</Badge>
                    </li>
                ))}
            </ul>
            <div className={styles.actions}>
                <Button variant="ghost" size="xs" onClick={onCancel} autoFocus>Cancel</Button>
                <Button variant="warning" size="xs" onClick={onConfirm}>
                    <Globe size={14} aria-hidden="true" /> Publish to {countLabel(channels.length, 'destination')}
                </Button>
            </div>
        </Stack>
    );
}
