'use client';

/**
 * @fileoverview The decision area at the foot of the review sheet: where the
 * content goes, and Approve or Reject.
 *
 * It is built around one risk. An approval that sends content to a public
 * destination cannot be undone, so the approve button itself changes to say
 * so — it turns amber and reads "Approve and publish" the moment a public
 * destination is selected — and a line under the buttons states what the
 * click will do. Approving with a public destination still asks for
 * confirmation first; approving privately and rejecting stay one click, the
 * fast path the queue depends on.
 *
 * The eligible destinations are secondary data, fetched for this item after it
 * opens, so they never hold up the queue. Until they arrive Approve is
 * disabled, so a fast click cannot take the plain approval path and skip the
 * destinations the picker would have pre-selected. The selection starts from
 * the type's saved default, which the curator confirms or changes.
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Check, Globe, X } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { cn } from '../../../../../lib/cn';
import {
    listSinks,
    type ICurationItemView,
    type ICurationEligibleSink,
    type ICurationSinkSelection
} from '../../../../../modules/curation';
import { sinkIsExternal } from './sinkIsExternal';
import { countLabel } from './countLabel';
import { SinkPicker } from './SinkPicker';
import { PublishConfirm } from './PublishConfirm';
import styles from './DecisionBar.module.scss';

/** Props for {@link DecisionBar}. */
export interface IDecisionBarProps {
    /** The pending item being decided. */
    item: ICurationItemView;
    /** Which decision on this item is in flight, so that button shows progress. */
    busyAction: 'approve' | 'reject' | null;
    /** Whether any decision is in flight, which locks every control. */
    locked: boolean;
    /** Approve the item with the curator's chosen destinations. */
    onApprove: (id: string, sinks?: ICurationSinkSelection[]) => void;
    /** Reject the item. */
    onReject: (id: string) => void;
    /** Save the current destination choice as the default for the item's type. */
    onSetDefault: (id: string, sinkIds: string[]) => void;
}

/** The sentence under the buttons, and whether it carries the public warning. */
interface IDecisionHint {
    text: string;
    warning: boolean;
}

/** What the decision hint needs to know about the current state. */
interface IDecisionHintInput {
    sinksLoading: boolean;
    hasPicker: boolean;
    selectedCount: number;
    publicCount: number;
    providerId: string;
}

/**
 * Write the sentence under the buttons that says what Approve will do right
 * now. It also explains a disabled Approve button, which on its own gives the
 * curator no reason.
 *
 * @param input - The loading state, the selection counts, and the sending plugin.
 * @returns The hint text and whether it is the public-publish warning.
 */
function decisionHint({ sinksLoading, hasPicker, selectedCount, publicCount, providerId }: IDecisionHintInput): IDecisionHint {
    let hint: IDecisionHint;
    if (sinksLoading) {
        hint = { text: 'Checking where this can be published…', warning: false };
    } else if (!hasPicker) {
        hint = { text: `Approving lets ${providerId} carry this out. Rejecting discards it.`, warning: false };
    } else if (selectedCount === 0) {
        hint = { text: 'Choose at least one destination before approving.', warning: false };
    } else if (publicCount === 0) {
        hint = { text: `Publishes to ${countLabel(selectedCount, 'private destination')}.`, warning: false };
    } else if (publicCount === selectedCount) {
        hint = { text: `Publishes to ${countLabel(publicCount, 'public destination')}. This can't be undone.`, warning: true };
    } else {
        const privateCount = selectedCount - publicCount;
        hint = {
            text: `Publishes to ${countLabel(publicCount, 'public destination')} and ${countLabel(privateCount, 'private one')}. This can't be undone.`,
            warning: true
        };
    }
    return hint;
}

/**
 * The decision area for one pending item.
 *
 * @param props - See {@link IDecisionBarProps}.
 * @returns The destination picker, the actions, and the hint.
 */
export function DecisionBar({ item, busyAction, locked, onApprove, onReject, onSetDefault }: IDecisionBarProps) {
    // null while the fetch is in flight; an empty array means there is no picker.
    const [sinks, setSinks] = useState<ICurationEligibleSink[] | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const { open, close } = useModal();
    const hintId = useId();

    /**
     * Fetch this item's eligible destinations and seed the selection from the
     * type's saved default. The `cancelled` guard drops a late reply if the
     * sheet has already moved on to another item.
     */
    useEffect(() => {
        let cancelled = false;
        listSinks(item.id)
            .then((eligible) => {
                if (!cancelled) {
                    setSinks(eligible);
                    setSelected(new Set(eligible.filter(sink => sink.defaultSelected).map(sink => sink.sinkId)));
                }
            })
            .catch(() => {
                // Destinations are secondary; on failure fall back to the plain
                // approval rather than blocking the decision.
                if (!cancelled) {
                    setSinks([]);
                }
            });
        return () => { cancelled = true; };
    }, [item.id]);

    /**
     * Add a destination to the selection, or remove it if already selected.
     *
     * @param sinkId - The destination to toggle.
     */
    const toggle = useCallback((sinkId: string) => {
        setSelected((previous) => {
            const next = new Set(previous);
            if (next.has(sinkId)) {
                next.delete(sinkId);
            } else {
                next.add(sinkId);
            }
            return next;
        });
    }, []);

    const sinksLoading = sinks === null;
    const hasPicker = sinks !== null && sinks.length > 0;
    // A publishing item must go somewhere: approving with nothing selected would
    // record the decision while publishing nowhere, which the service refuses.
    const noSinkSelected = hasPicker && selected.size === 0;

    // The public destinations in the current selection — what the confirmation
    // names, and the test for whether it appears at all.
    const selectedPublic = useMemo(
        () => (sinks ?? []).filter(sink => selected.has(sink.sinkId) && sinkIsExternal(sink.reach)),
        [sinks, selected]
    );
    const publishing = selectedPublic.length > 0;

    /**
     * Send the approval with the chosen destinations, or with none when this
     * item has no picker, which keeps the plain single-effect approval.
     */
    const commitApprove = useCallback(() => {
        const approveSinks = hasPicker
            ? Array.from(selected).map((sinkId): ICurationSinkSelection => ({ sinkId }))
            : undefined;
        onApprove(item.id, approveSinks);
    }, [hasPicker, selected, onApprove, item.id]);

    /**
     * Approve, asking for confirmation first when any selected destination is
     * public. The extra step lands only where the effect cannot be undone.
     */
    const handleApprove = useCallback(() => {
        if (!publishing) {
            commitApprove();
        } else {
            const modalId = `curation-publish-${item.id}`;
            open({
                id: modalId,
                title: 'Publish publicly?',
                size: 'sm',
                content: (
                    <PublishConfirm
                        channels={selectedPublic}
                        onCancel={() => close(modalId)}
                        onConfirm={() => { close(modalId); commitApprove(); }}
                    />
                )
            });
        }
    }, [publishing, commitApprove, open, close, item.id, selectedPublic]);

    const hint = decisionHint({
        sinksLoading,
        hasPicker,
        selectedCount: selected.size,
        publicCount: selectedPublic.length,
        providerId: item.providerId
    });

    return (
        <div className={styles.bar}>
            {hasPicker && (
                <SinkPicker
                    sinks={sinks}
                    selected={selected}
                    disabled={locked}
                    onToggle={toggle}
                    onSetDefault={() => onSetDefault(item.id, Array.from(selected))}
                />
            )}

            <div className={styles.actions}>
                <Button
                    variant={publishing ? 'warning' : 'primary'}
                    size="sm"
                    loading={busyAction === 'approve'}
                    disabled={locked || sinksLoading || noSinkSelected}
                    onClick={handleApprove}
                    aria-describedby={hintId}
                >
                    {publishing ? <Globe size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                    {publishing ? 'Approve and publish' : 'Approve'}
                </Button>
                <Button
                    variant="danger"
                    size="sm"
                    className={styles.reject}
                    loading={busyAction === 'reject'}
                    disabled={locked}
                    onClick={() => onReject(item.id)}
                >
                    <X size={16} aria-hidden="true" /> Reject
                </Button>
            </div>

            <p id={hintId} className={cn(styles.hint, hint.warning && styles.hint_warning)} aria-live="polite">
                {hint.text}
            </p>
        </div>
    );
}
