'use client';

/**
 * @fileoverview Curation queue — the central inbox of effects held for human
 * review across every content type. Each item renders from its content-agnostic
 * preview (title, body, media, fields); approving commits the effect through its
 * owning plugin, rejecting discards it. An item whose owning plugin is disabled
 * returns a 409 the toast surfaces, since it cannot be decided until re-enabled.
 * A Pending/History toggle switches between the live queue and the read-only
 * audit of past decisions — decisions never delete a record, so history is just
 * the decided items, rendered from their frozen snapshot with no actions.
 * Refetches on the `curation:changed` signal and reports the new count up via
 * `onChanged` so the header badge stays live. Like the sibling system surfaces
 * this is an admin client surface, not an SSR-first public component.
 */

import { useEffect, useState, useCallback } from 'react';
import { Check, X, Pencil } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Button } from '../../../../components/ui/Button';
import { Textarea } from '../../../../components/ui/Textarea';
import { Badge } from '../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import { getSocket } from '../../../../lib/socketClient';
import {
    listCurations,
    listCurationHistory,
    listDestinations,
    setDestinationDefaults,
    approveCuration,
    rejectCuration,
    editCuration,
    type ICurationItemView,
    type ICurationEligibleDestination,
    type ICurationDestinationOutcome,
    type ICurationDestinationSelection
} from '../../../../modules/curation';
import styles from './page.module.scss';

/** Truncate body text for the inline preview cell. */
function truncate(text: string, max = 160): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Inline editor body for the edit modal. Edits the generic `body` text; the
 * owning plugin validates and writes through its own `applyEdit`. `onSave` owns
 * closing the modal on success and reporting failure, so a rejected edit (e.g.
 * over the tweet limit) keeps the modal open for correction.
 *
 * @param props.initialBody - The body text to prefill.
 * @param props.onCancel - Close without saving.
 * @param props.onSave - Persist the edited body; resolves when handled.
 * @returns The editor form.
 */
function CurationEditForm({ initialBody, onCancel, onSave }: {
    initialBody: string;
    onCancel: () => void;
    onSave: (body: string) => Promise<void>;
}) {
    const [body, setBody] = useState(initialBody);
    const [saving, setSaving] = useState(false);

    const submit = useCallback(async () => {
        setSaving(true);
        try {
            await onSave(body);
        } finally {
            setSaving(false);
        }
    }, [body, onSave]);

    return (
        <Stack gap="md">
            <Textarea
                value={body}
                onChange={event => setBody(event.target.value)}
                rows={5}
                aria-label="Edit held content"
                disabled={saving}
            />
            <div className={styles.row_actions}>
                <Button variant="primary" size="sm" loading={saving} onClick={() => { void submit(); }}>Save</Button>
                <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}>Cancel</Button>
            </div>
        </Stack>
    );
}

/**
 * Render one held item's content-agnostic preview: body, an optional media
 * thumbnail, and labelled fields. Core knows nothing of the underlying payload —
 * the owning type flattened it into this descriptor.
 *
 * @param props.preview - The preview descriptor from the curation envelope.
 * @returns The preview cell content.
 */
function CurationPreview({ preview }: { preview: ICurationItemView['preview'] }) {
    const image = preview.media?.find(media => media.kind !== 'link');
    return (
        <div className={styles.curation_preview}>
            {preview.body && <div className={styles.curation_body}>{truncate(preview.body)}</div>}
            {image && (
                // Resolved public URL from the owning plugin; next/image adds no
                // value for an admin-only, externally-sized thumbnail.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image.url} alt={image.alt ?? 'Attached media'} className={styles.curation_thumb} loading="lazy" />
            )}
            {preview.details && preview.details.length > 0 && (
                <div className={styles.curation_fields}>
                    {preview.details.map((field, index) => (
                        <span key={`${field.label}-${index}`} className={styles.curation_field}>
                            <span className={styles.curation_field_label}>{field.label}:</span> {field.value}
                        </span>
                    ))}
                </div>
            )}
            {preview.editable && <Badge tone="info">editable</Badge>}
        </div>
    );
}

/**
 * Map a destination delivery status to a Badge tone, so an operator reads where
 * approved content landed at a glance: delivered succeeds, failed alarms, pending
 * is neutral (the leg was committed but the relay has not settled it).
 *
 * @param status - The per-destination delivery status.
 * @returns The Badge tone for that status.
 */
function outcomeTone(status: ICurationDestinationOutcome['status']): 'success' | 'danger' | 'neutral' {
    if (status === 'delivered') {
        return 'success';
    }
    return status === 'failed' ? 'danger' : 'neutral';
}

/**
 * Render the per-destination delivery outcomes of an approved item as toned
 * badges — the audit of which publish sinks a curator's approval reached and
 * which failed. A failed leg carries its error in the badge's `title` so the
 * detail is one hover away without cluttering the row. Renders nothing when the
 * item fanned out to no destinations (a classic single-effect approval).
 *
 * @param props.destinations - The recorded destination outcomes, if any.
 * @returns The outcomes badges, or null when there are none.
 */
function CurationOutcomes({ destinations }: { destinations?: ICurationDestinationOutcome[] }) {
    if (!destinations || destinations.length === 0) {
        return null;
    }
    return (
        <div className={styles.destination_outcomes}>
            {destinations.map((outcome) => (
                <Badge key={outcome.sinkId} tone={outcomeTone(outcome.status)}>
                    <span title={outcome.error}>{outcome.sinkId}: {outcome.status}</span>
                </Badge>
            ))}
        </div>
    );
}

/**
 * Render a decided item's outcome for the history view: the terminal status as a
 * toned badge, the per-destination delivery outcomes (when the approval fanned
 * out), when it was decided, and the deciding curator's Better Auth id. Read-only
 * by design — a history row offers no actions because its effect already
 * committed or was discarded, and the record exists only as an audit trail.
 *
 * @param props.item - The decided curation envelope (status is approved/rejected).
 * @returns The decision cell content.
 */
function CurationDecision({ item }: { item: ICurationItemView }) {
    return (
        <div className={styles.curation_preview}>
            <Badge tone={item.status === 'approved' ? 'success' : 'danger'}>{item.status}</Badge>
            <CurationOutcomes destinations={item.destinations} />
            {item.decidedAt && (
                <div className={styles.tool_desc}><ClientTime date={item.decidedAt} format="datetime" /></div>
            )}
            {item.decidedBy && <div className={styles.tool_desc}>by {item.decidedBy}</div>}
        </div>
    );
}

/**
 * Pending-row actions for one held item: the destination picker (when the item's
 * type publishes to destinations and sinks are eligible) plus Approve / Edit /
 * Reject. The eligible destinations are SECONDARY data, lazily fetched per row
 * after mount, so they never block the primary queue render; an item with no
 * eligible destinations shows the classic plain Approve button unchanged. The
 * checkbox selection seeds from standing policy (`defaultSelected`) and the
 * curator confirms or overrides it before approving — the human review gate
 * doubling as the mandated-subset selector.
 *
 * @param props.item - The pending curation envelope.
 * @param props.busyId - The id of the row currently deciding, or null.
 * @param props.onApprove - Approve the item with the curator's selected destinations.
 * @param props.onReject - Reject the item.
 * @param props.onEdit - Open the inline editor for the item.
 * @param props.onSetDefault - Save the current selection as the type's default.
 * @returns The pending-row action controls.
 */
function PendingActions({ item, busyId, onApprove, onReject, onEdit, onSetDefault }: {
    item: ICurationItemView;
    busyId: string | null;
    onApprove: (id: string, destinations?: ICurationDestinationSelection[]) => void;
    onReject: (id: string) => void;
    onEdit: (item: ICurationItemView) => void;
    onSetDefault: (id: string, sinkIds: string[]) => void;
}) {
    // null while the lazy fetch is in flight; an empty array means "no picker".
    const [destinations, setDestinations] = useState<ICurationEligibleDestination[] | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    // Fetch the item's eligible destinations once after mount and seed the
    // selection from standing policy. A `cancelled` guard drops a late resolve if
    // the row unmounts (e.g. the queue refetched) so it cannot set stale state.
    useEffect(() => {
        let cancelled = false;
        listDestinations(item.id)
            .then((eligible) => {
                if (cancelled) {
                    return;
                }
                setDestinations(eligible);
                setSelected(new Set(eligible.filter((d) => d.defaultSelected).map((d) => d.sinkId)));
            })
            .catch(() => {
                // Destinations are secondary; on failure fall back to the plain
                // approve flow rather than blocking the decision.
                if (!cancelled) {
                    setDestinations([]);
                }
            });
        return () => { cancelled = true; };
    }, [item.id]);

    const toggle = useCallback((sinkId: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(sinkId)) {
                next.delete(sinkId);
            } else {
                next.add(sinkId);
            }
            return next;
        });
    }, []);

    const busy = busyId === item.id;
    const blockedByOther = busyId !== null && busyId !== item.id;
    const hasPicker = destinations !== null && destinations.length > 0;
    // Eligibility is unknown until this row's fetch settles (destinations === null);
    // block approval during that window so a fast click cannot take the classic
    // path and silently skip the publish destinations the picker would have selected.
    const destinationsLoading = destinations === null;
    const approveDestinations = hasPicker
        ? Array.from(selected).map((sinkId): ICurationDestinationSelection => ({ sinkId }))
        : undefined;

    return (
        <Stack gap="sm">
            {destinations !== null && destinations.length > 0 && (
                <fieldset className={styles.destination_picker}>
                    <legend className={styles.destination_legend}>Publish to</legend>
                    {destinations.map((dest) => (
                        <label key={dest.sinkId} className={styles.destination_option}>
                            <input
                                type="checkbox"
                                checked={selected.has(dest.sinkId)}
                                disabled={busy}
                                onChange={() => toggle(dest.sinkId)}
                            />
                            <span className={styles.destination_label}>{dest.label ?? dest.sinkId}</span>
                            <Badge tone="info">{dest.reach.egress}/{dest.reach.audience}</Badge>
                        </label>
                    ))}
                    <Button variant="ghost" size="xs" disabled={busy} onClick={() => onSetDefault(item.id, Array.from(selected))}>
                        Set as default for this type
                    </Button>
                </fieldset>
            )}
            <div className={styles.row_actions}>
                <Button variant="primary" size="sm" loading={busy} disabled={blockedByOther || destinationsLoading} onClick={() => onApprove(item.id, approveDestinations)}>
                    <Check size={16} /> Approve
                </Button>
                {item.preview.editable && (
                    <Button variant="secondary" size="sm" disabled={busyId !== null} onClick={() => onEdit(item)}>
                        <Pencil size={16} /> Edit
                    </Button>
                )}
                <Button variant="danger" size="sm" disabled={blockedByOther} onClick={() => onReject(item.id)}>
                    <X size={16} /> Reject
                </Button>
            </div>
        </Stack>
    );
}

/**
 * Curation queue content.
 *
 * @param props.onChanged - Called after load/approve/reject so the page header
 *                          pending badge refreshes.
 * @returns The queue.
 */
export function CurationQueue({ onChanged }: { onChanged: () => void }) {
    const [view, setView] = useState<'pending' | 'history'>('pending');
    const [items, setItems] = useState<ICurationItemView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const { push } = useToast();
    const { open, close } = useModal();

    const load = useCallback(async () => {
        try {
            setItems(await (view === 'pending' ? listCurations() : listCurationHistory()));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to load curation ${view}`);
        } finally {
            setLoading(false);
        }
    }, [view]);

    // Switching views is a user action, so a brief loading state is acceptable here
    // (admin surface, not SSR-first primary content); reset it so the prior view's
    // rows don't linger under the new view's header while the fetch is in flight.
    // A `cancelled` flag discards a slower earlier fetch that resolves after the
    // user has already toggled to the other view, so its stale rows can't overwrite
    // the current view's state (matches the menu/page.tsx load guard).
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        (async () => {
            try {
                const next = await (view === 'pending' ? listCurations() : listCurationHistory());
                if (cancelled) return;
                setItems(next);
                setError(null);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : `Failed to load curation ${view}`);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [view]);

    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void load(); onChanged(); };
        socket.on('curation:changed', handler);
        return () => { socket.off('curation:changed', handler); };
    }, [load, onChanged]);

    const resolve = useCallback(async (id: string, action: 'approve' | 'reject', destinations?: ICurationDestinationSelection[]) => {
        setBusyId(id);
        try {
            await (action === 'approve' ? approveCuration(id, destinations) : rejectCuration(id));
            const fanned = action === 'approve' && destinations !== undefined && destinations.length > 0;
            push({
                tone: action === 'approve' ? 'success' : 'info',
                title: action === 'approve' ? 'Approved' : 'Rejected',
                description: fanned ? `Publishing to ${destinations.length} destination${destinations.length === 1 ? '' : 's'}.` : undefined
            });
            await load();
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: `Failed to ${action}`, description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusyId(null);
        }
    }, [load, onChanged, push]);

    // Persist the curator's current selection as the content type's standing
    // default — a policy-data redirect, not a per-item decision — so the picker
    // pre-checks it on future items of the type. Failure is non-fatal; the
    // approval flow is unaffected.
    const setDefault = useCallback(async (id: string, sinkIds: string[]) => {
        try {
            await setDestinationDefaults(id, sinkIds);
            push({ tone: 'success', title: 'Saved as default', description: `${sinkIds.length} destination${sinkIds.length === 1 ? '' : 's'} will be pre-selected for this type.` });
        } catch (err) {
            push({ tone: 'danger', title: 'Failed to save default', description: err instanceof Error ? err.message : String(err) });
        }
    }, [push]);

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
                            // Keep the modal open so the operator can correct a
                            // rejected edit (e.g. over the tweet length limit).
                            push({ tone: 'danger', title: 'Failed to save', description: err instanceof Error ? err.message : String(err) });
                        }
                    }}
                />
            )
        });
    }, [open, close, load, onChanged, push]);

    const isHistory = view === 'history';

    return (
        <Stack gap="md">
            <div className={styles.row_actions} role="group" aria-label="Curation view">
                <Button variant={isHistory ? 'ghost' : 'primary'} size="sm" onClick={() => setView('pending')}>Pending</Button>
                <Button variant={isHistory ? 'primary' : 'ghost'} size="sm" onClick={() => setView('history')}>History</Button>
            </div>
            {error && <div className="alert" role="alert">{error}</div>}
            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                {isHistory
                    ? 'Past curation decisions, most recent first. Records persist after a decision; each row shows its frozen preview, the outcome, and who decided.'
                    : 'Effects held for human review across every content type. Approving commits the effect through its owning plugin; rejecting discards it. An item whose owning plugin is disabled cannot be decided until it is re-enabled.'}
            </p>
            {loading
                ? <div className={styles.placeholder}>Loading…</div>
                : items.length === 0
                    ? <div className={styles.placeholder}>{isHistory ? 'No curation decisions yet.' : 'Nothing is awaiting curation.'}</div>
                    : (
                        <div className="table-scroll">
                            <Table>
                                <Thead>
                                    <Tr>
                                        <Th width="shrink">Held</Th>
                                        <Th width="shrink">Type</Th>
                                        <Th>Preview</Th>
                                        <Th width="shrink">Decision</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {items.map(item => (
                                        <Tr key={item.id}>
                                            <Td muted><ClientTime date={item.createdAt} format="datetime" /></Td>
                                            <Td>
                                                <div className={styles.tool_name}>{item.preview.title ?? item.typeId}</div>
                                                <div className={styles.tool_desc}>
                                                    {item.providerId}{item.source ? ` · ${item.source}` : ''}
                                                </div>
                                            </Td>
                                            <Td><CurationPreview preview={item.preview} /></Td>
                                            <Td>
                                                {isHistory
                                                    ? <CurationDecision item={item} />
                                                    : (
                                                        <PendingActions
                                                            item={item}
                                                            busyId={busyId}
                                                            onApprove={(id, destinations) => { void resolve(id, 'approve', destinations); }}
                                                            onReject={(id) => { void resolve(id, 'reject'); }}
                                                            onEdit={openEditor}
                                                            onSetDefault={(id, sinkIds) => { void setDefault(id, sinkIds); }}
                                                        />
                                                    )}
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
