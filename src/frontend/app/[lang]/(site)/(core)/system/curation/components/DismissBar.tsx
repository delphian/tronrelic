'use client';

/**
 * @fileoverview The decision area shown in place of Approve and Reject when the
 * plugin that held an item is no longer installed.
 *
 * Approve and Reject both hand the decision back to the owning plugin, so with
 * the plugin gone they can only fail. Without another way out, the item would
 * sit in the queue forever. Dismiss closes it without calling the plugin and
 * records who closed it and why, so the History tab still explains it.
 *
 * It reuses the DecisionBar styles because it occupies the same slot at the
 * foot of the review sheet and has to look like the same area.
 */

import { useId } from 'react';
import { Archive } from 'lucide-react';
import { Button } from '../../../../../../../components/ui/Button';
import type { ICurationItemView } from '../../../../../../../modules/curation';
import styles from './DecisionBar.module.scss';

/** Props for {@link DismissBar}. */
export interface IDismissBarProps {
    /** The pending item whose owning plugin is gone. */
    item: ICurationItemView;
    /** Whether the dismissal of this item is in flight, so the button shows progress. */
    busy: boolean;
    /** Whether any decision is in flight, which locks the button. */
    locked: boolean;
    /** Close the item without calling its owner. */
    onDismiss: (id: string) => void;
}

/**
 * The dismiss-only decision area for one pending item.
 *
 * @param props - See {@link IDismissBarProps}.
 * @returns The Dismiss button and the sentence explaining why it is the only action.
 */
export function DismissBar({ item, busy, locked, onDismiss }: IDismissBarProps) {
    const hintId = useId();

    return (
        <div className={styles.bar}>
            <div className={styles.actions}>
                <Button
                    variant="secondary"
                    size="sm"
                    loading={busy}
                    disabled={locked}
                    onClick={() => onDismiss(item.id)}
                    aria-describedby={hintId}
                >
                    <Archive size={16} aria-hidden="true" /> Dismiss
                </Button>
            </div>

            <p id={hintId} className={styles.hint}>
                {`${item.providerId} is not installed, so this item can't be approved or rejected. Dismissing closes it without calling ${item.providerId} and keeps it in History.`}
            </p>
        </div>
    );
}
