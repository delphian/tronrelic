'use client';

/**
 * @fileoverview Pending tab — the live curation queue as a review desk. The
 * queue list sits on the left and the item under review fills the right, so
 * the curator decides one item at a time without losing sight of how many are
 * left. Approving commits the effect through its owning plugin; rejecting
 * discards it. An item whose owning plugin is disabled returns a 409 that the
 * toast reports, since it cannot be decided until the plugin is re-enabled.
 *
 * After a decision the next item opens on its own: the one that slid into the
 * decided item's place in the list, which is the next one down. Refetches on
 * the `curation:changed` signal so a hold from elsewhere appears without a
 * reload. Like the other System pages this is an admin client surface that
 * loads its data after mount, not a server-rendered public component.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { getSocket } from '../../../../../lib/socketClient';
import {
    listCurations,
    approveCuration,
    rejectCuration,
    editCuration,
    setSinkDefaults,
    type ICurationItemView,
    type ICurationSinkSelection
} from '../../../../../modules/curation';
import { QueueRail } from '../components/QueueRail';
import { ReviewSheet } from '../components/ReviewSheet';
import { CurationEditForm } from '../components/CurationEditForm';
import { countLabel } from '../components/countLabel';
import styles from './PendingTab.module.scss';

/** The decision currently in flight, so only its button shows progress. */
interface IBusyDecision {
    id: string;
    action: 'approve' | 'reject';
}

/**
 * Choose which item the review sheet shows after the list changes. Keeps the
 * current item when it is still waiting. When it has gone — decided here or by
 * another admin — opens the item now at its old position, which is the next
 * one down, so working through the queue never needs a click on the list.
 *
 * @param current - The id open before the change, or null.
 * @param previous - The list before the change.
 * @param next - The list after the change.
 * @returns The id to open, or null when the queue is empty.
 */
function pickSelection(current: string | null, previous: ICurationItemView[], next: ICurationItemView[]): string | null {
    let selection: string | null = next[0]?.id ?? null;
    if (current !== null && next.some(item => item.id === current)) {
        selection = current;
    } else if (current !== null && next.length > 0) {
        const formerIndex = previous.findIndex(item => item.id === current);
        if (formerIndex >= 0) {
            selection = next[Math.min(formerIndex, next.length - 1)].id;
        }
    }
    return selection;
}

/**
 * Pull a readable message out of whatever a failed request threw.
 *
 * @param err - The caught value.
 * @returns The error's message, or the value as text.
 */
function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

/**
 * Pending tab content.
 *
 * @param props.onChanged - Called after a decision or edit so the page's
 *   waiting count refreshes even when WebSockets are disabled.
 * @returns The tab.
 */
export function PendingTab({ onChanged }: { onChanged: () => void }) {
    const [items, setItems] = useState<ICurationItemView[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<IBusyDecision | null>(null);
    const [focusSheet, setFocusSheet] = useState(false);
    // The list as last applied, read when working out which item to open next.
    const itemsRef = useRef<ICurationItemView[]>([]);
    const { push } = useToast();
    const { open, close } = useModal();

    /**
     * Replace the list and move the selection along with it. The previous list
     * is captured here, before the ref is overwritten, because the selection
     * updater runs later during render.
     *
     * @param next - The freshly fetched queue.
     */
    const applyList = useCallback((next: ICurationItemView[]) => {
        const previous = itemsRef.current;
        itemsRef.current = next;
        setItems(next);
        setSelectedId(current => pickSelection(current, previous, next));
    }, []);

    /** Fetch the queue, reporting a failure above the desk. */
    const load = useCallback(async () => {
        try {
            applyList(await listCurations());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load the curation queue');
        } finally {
            setLoading(false);
        }
    }, [applyList]);

    /** Load the queue once the tab mounts. */
    useEffect(() => {
        void load();
    }, [load]);

    /** Refetch whenever the module signals that the queue changed. */
    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void load(); };
        socket.on('curation:changed', handler);
        return () => { socket.off('curation:changed', handler); };
    }, [load]);

    /**
     * Open an item chosen from the list. Focus stays in the list so a keyboard
     * user can keep moving through it.
     *
     * @param id - The item to open.
     */
    const handleSelect = useCallback((id: string) => {
        setFocusSheet(false);
        setSelectedId(id);
    }, []);

    /**
     * Approve or reject an item, then refetch so the next item opens.
     *
     * @param id - The item to decide.
     * @param action - Approve (commit) or reject (discard).
     * @param sinks - The destinations chosen for an approval, if any.
     */
    const resolve = useCallback(async (id: string, action: 'approve' | 'reject', sinks?: ICurationSinkSelection[]) => {
        setBusy({ id, action });
        try {
            await (action === 'approve' ? approveCuration(id, sinks) : rejectCuration(id));
            const fanned = action === 'approve' && sinks !== undefined && sinks.length > 0;
            push({
                tone: action === 'approve' ? 'success' : 'info',
                title: action === 'approve' ? 'Approved' : 'Rejected',
                description: fanned ? `Publishing to ${countLabel(sinks.length, 'destination')}.` : undefined
            });
            setFocusSheet(true);
            await load();
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: `Failed to ${action}`, description: messageOf(err) });
        } finally {
            setBusy(null);
        }
    }, [load, onChanged, push]);

    /**
     * Save the current destination choice as the default for the item's content
     * type, so the picker pre-selects it on future items of that type. This is
     * a policy change, not a decision, and a failure leaves the item untouched.
     *
     * @param id - An item of the type whose default to set.
     * @param sinkIds - The destinations to pre-select from now on.
     */
    const setDefault = useCallback(async (id: string, sinkIds: string[]) => {
        try {
            await setSinkDefaults(id, sinkIds);
            push({
                tone: 'success',
                title: 'Saved as the default',
                description: `${countLabel(sinkIds.length, 'destination')} will be pre-selected for this type.`
            });
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to save the default', description: messageOf(err) });
        }
    }, [push]);

    /**
     * Open the text editor for an item. A rejected edit keeps the modal open so
     * the curator can correct it, for example a tweet over the length limit.
     *
     * @param item - The item whose text to edit.
     */
    const openEditor = useCallback((item: ICurationItemView) => {
        const modalId = 'curation-edit';
        open({
            id: modalId,
            title: 'Edit before deciding',
            size: 'md',
            content: (
                <CurationEditForm
                    initialBody={item.preview.body ?? ''}
                    onCancel={() => close(modalId)}
                    onSave={async (body) => {
                        try {
                            await editCuration(item.id, { body });
                            push({ tone: 'success', title: 'Saved' });
                            close(modalId);
                            await load();
                            onChanged();
                        } catch (err) {
                            push({ tone: 'danger', title: 'Failed to save', description: messageOf(err) });
                        }
                    }}
                />
            )
        });
    }, [open, close, load, onChanged, push]);

    const selected = items.find(item => item.id === selectedId) ?? null;

    let body: ReactNode;
    if (loading && items.length === 0) {
        body = <p className={styles.placeholder}>Loading the queue…</p>;
    } else if (items.length === 0) {
        body = error ? null : (
            <div className={styles.empty}>
                <ClipboardCheck size={24} aria-hidden="true" className={styles.empty_icon} />
                <p className={styles.empty_title}>Nothing is waiting for review.</p>
                <p className={styles.empty_note}>New items appear here as soon as a plugin holds one for a decision.</p>
            </div>
        );
    } else {
        body = (
            <div className={styles.desk}>
                <div className={styles.rail_slot}>
                    <div className={styles.rail_fill}>
                        <QueueRail items={items} selectedId={selectedId} onSelect={handleSelect} />
                    </div>
                </div>
                {selected && (
                    <ReviewSheet
                        key={selected.id}
                        item={selected}
                        busyAction={busy?.id === selected.id ? busy.action : null}
                        locked={busy !== null}
                        autoFocusHeading={focusSheet}
                        onApprove={(id, sinks) => { void resolve(id, 'approve', sinks); }}
                        onReject={(id) => { void resolve(id, 'reject'); }}
                        onEdit={openEditor}
                        onSetDefault={(id, sinkIds) => { void setDefault(id, sinkIds); }}
                    />
                )}
            </div>
        );
    }

    return (
        <div className={styles.pending}>
            {error && <div className="alert" role="alert">{error}</div>}
            {body}
        </div>
    );
}
