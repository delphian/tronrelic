'use client';

/**
 * @fileoverview The item under review: a heading naming it, where it came from
 * and how long it has waited, the content as a proof, and the decision area at
 * the foot. Editing the text sits in the heading row because it changes the
 * content, not the decision, so the decision area holds only Approve and
 * Reject and the choice of where the content goes.
 *
 * After a decision the Pending tab opens the next item, and the heading takes
 * focus so a keyboard or screen reader user lands on the new item instead of
 * on a button that no longer exists.
 *
 * When the plugin that held the item is no longer installed, the decision area
 * offers only Dismiss and the Edit button is hidden, because approving,
 * rejecting, and editing all need that plugin.
 */

import { useEffect, useId, useRef } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '../../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import type { ICurationItemView, ICurationSinkSelection } from '../../../../../../../modules/curation';
import { CurationPreview } from './CurationPreview';
import { DecisionBar } from './DecisionBar';
import { DismissBar } from './DismissBar';
import styles from './ReviewSheet.module.scss';

/** A decision the Pending tab can send for one item. */
export type CurationAction = 'approve' | 'reject' | 'dismiss';

/** Props for {@link ReviewSheet}. */
export interface IReviewSheetProps {
    /** The pending item to show. */
    item: ICurationItemView;
    /** Which decision on this item is in flight, so that button shows progress. */
    busyAction: CurationAction | null;
    /** Whether any decision is in flight, which locks every control. */
    locked: boolean;
    /** Move focus to the heading on mount; set after a decision advanced the queue. */
    autoFocusHeading: boolean;
    /** Approve the item with the curator's chosen destinations. */
    onApprove: (id: string, sinks?: ICurationSinkSelection[]) => void;
    /** Reject the item. */
    onReject: (id: string) => void;
    /** Close an item whose owning plugin is gone, without calling it. */
    onDismiss: (id: string) => void;
    /** Open the text editor for the item. */
    onEdit: (item: ICurationItemView) => void;
    /** Save the current destination choice as the default for the item's type. */
    onSetDefault: (id: string, sinkIds: string[]) => void;
}

/**
 * The review sheet for one pending item.
 *
 * @param props - See {@link IReviewSheetProps}.
 * @returns The sheet.
 */
export function ReviewSheet({ item, busyAction, locked, autoFocusHeading, onApprove, onReject, onDismiss, onEdit, onSetDefault }: IReviewSheetProps) {
    const headingId = useId();
    const headingRef = useRef<HTMLHeadingElement | null>(null);
    // Only an explicit false means the owner is gone; an older backend that does
    // not send the flag keeps the normal decision area.
    const ownerMissing = item.ownerAvailable === false;

    /**
     * Hand focus to the heading when this sheet replaced one that was just
     * decided, so assistive technology announces the next item.
     */
    useEffect(() => {
        if (autoFocusHeading) {
            headingRef.current?.focus();
        }
    }, [autoFocusHeading]);

    return (
        <article className={styles.sheet} aria-labelledby={headingId}>
            <header className={styles.head}>
                <div className={styles.head_text}>
                    <h2 id={headingId} ref={headingRef} tabIndex={-1} className={styles.title}>
                        {item.preview.title ?? item.typeId}
                    </h2>
                    <p className={styles.meta}>
                        <span>From {item.providerId}</span>
                        {item.source && <span>Via {item.source}</span>}
                        <span>Held <ClientTime date={item.createdAt} format="datetime" /></span>
                    </p>
                </div>
                {item.preview.editable && !ownerMissing && (
                    <Button variant="ghost" size="xs" disabled={locked} onClick={() => onEdit(item)}>
                        <Pencil size={14} aria-hidden="true" /> Edit text
                    </Button>
                )}
            </header>

            <div className={styles.content}>
                <CurationPreview preview={item.preview} />
            </div>

            {ownerMissing ? (
                <DismissBar
                    item={item}
                    busy={busyAction === 'dismiss'}
                    locked={locked}
                    onDismiss={onDismiss}
                />
            ) : (
                <DecisionBar
                    item={item}
                    busyAction={busyAction === 'dismiss' ? null : busyAction}
                    locked={locked}
                    onApprove={onApprove}
                    onReject={onReject}
                    onSetDefault={onSetDefault}
                />
            )}
        </article>
    );
}
