'use client';

/**
 * @fileoverview Curation queue — the central inbox of effects held for human
 * review across every content type. Pending items render as focused review
 * cards: the content on one side, a decision rail on the other holding the
 * destination picker and Approve / Edit / Reject. Approving commits the effect
 * through its owning plugin, rejecting discards it; an item whose owning plugin
 * is disabled returns a 409 the toast surfaces, since it cannot be decided until
 * re-enabled.
 *
 * The decision rail is built around one risk: an approval that fans content to a
 * public destination cannot be undone. So the picker separates the calm
 * internal/admin sinks from the amber external/public ones, and any approval
 * whose selection includes an external destination is gated behind an explicit
 * confirmation — internal-only approval and rejection stay one click, the fast
 * path the queue depends on.
 *
 * A Pending/History toggle switches between the live queue and the read-only
 * audit of past decisions. Decisions never delete a record, so History is just
 * the decided items rendered from their frozen snapshot as a scannable table —
 * audit data you skim, not work you act on, which is why it keeps the table
 * primitive the review cards deliberately leave behind. Refetches on the
 * `curation:changed` signal and reports the new count up via `onChanged` so the
 * header badge stays live. Like the sibling system surfaces this is an admin
 * client surface, not an SSR-first public component.
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Check, X, Pencil, Lock, Globe, AlertTriangle } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Button } from '../../../../components/ui/Button';
import { Card } from '../../../../components/ui/Card';
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

/** Body length past which the expandable preview collapses behind a toggle. */
const COLLAPSE_AT = 280;

/** Truncate body text for an inline preview. */
function truncate(text: string, max = 160): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Decide whether a destination's reach leaves the safe internal/admin zone —
 * the single predicate that drives the picker's amber grouping and the
 * publish-confirmation gate. A sink counts as external when it either leaves the
 * platform (`egress` past `internal`) or widens to the public (`audience` is
 * `public`); both are exposures an operator must not trigger by reflex. Erring
 * toward "external" is deliberate: a false amber costs one confirmation click, a
 * false calm costs an irreversible public publish.
 *
 * @param reach - The destination's reach classification.
 * @returns True when delivering to this sink is an external/public exposure.
 */
function destinationIsExternal(reach: ICurationEligibleDestination['reach']): boolean {
    return reach.egress !== 'internal' || reach.audience === 'public';
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
 * Confirmation body shown before an approval that would fan content to one or
 * more external/public destinations. Restating exactly which public channels
 * will fire — and that the effect cannot be undone — is the deliberate friction
 * that turns a reflex click into a decision; the default focus sits on Cancel so
 * the dangerous path is never the one a stray Enter takes.
 *
 * @param props.channels - The selected external/public destinations to name.
 * @param props.onConfirm - Proceed with the approval and its destination fan-out.
 * @param props.onCancel - Dismiss without approving, returning to the rail.
 * @returns The confirmation form.
 */
function PublishConfirm({ channels, onConfirm, onCancel }: {
    channels: ICurationEligibleDestination[];
    onConfirm: () => void;
    onCancel: () => void;
}) {
    return (
        <Stack gap="md">
            <div className={styles.confirm_warning} role="alert">
                <AlertTriangle size={18} aria-hidden />
                <span>This publishes externally and cannot be undone.</span>
            </div>
            <ul className={styles.confirm_list}>
                {channels.map(channel => (
                    <li key={channel.sinkId} className={styles.confirm_item}>
                        <Globe size={14} aria-hidden />
                        <span className={styles.dest_label}>{channel.label ?? channel.sinkId}</span>
                        <Badge tone="warning">{channel.reach.egress}/{channel.reach.audience}</Badge>
                    </li>
                ))}
            </ul>
            <div className={styles.row_actions}>
                <Button variant="ghost" size="sm" onClick={onCancel} autoFocus>Cancel</Button>
                <Button variant="primary" size="sm" onClick={onConfirm}>
                    <Check size={16} /> Publish to {channels.length} external channel{channels.length === 1 ? '' : 's'}
                </Button>
            </div>
        </Stack>
    );
}

/**
 * Render one held item's content-agnostic preview: body, an optional media
 * thumbnail, and labelled fields. Core knows nothing of the underlying payload —
 * the owning type flattened it into this descriptor. In `expandable` mode (the
 * review card) the full body is available behind an in-place expand so a long
 * draft never forces a navigate-away; in compact mode (the history table) the
 * body is hard-truncated to keep rows scannable.
 *
 * @param props.preview - The preview descriptor from the curation envelope.
 * @param props.expandable - Show the full body behind an expand toggle when long.
 * @returns The preview content.
 */
function CurationPreview({ preview, expandable = false }: { preview: ICurationItemView['preview']; expandable?: boolean }) {
    const [expanded, setExpanded] = useState(false);
    const image = preview.media?.find(media => media.kind !== 'link');
    const body = preview.body ?? '';
    const isLong = expandable && body.length > COLLAPSE_AT;
    const shownBody = !expandable
        ? truncate(body)
        : (expanded || !isLong ? body : truncate(body, COLLAPSE_AT));

    const toggleExpanded = useCallback(() => { setExpanded(prev => !prev); }, []);

    return (
        <div className={styles.curation_preview}>
            {preview.body && <div className={styles.curation_body}>{shownBody}</div>}
            {isLong && (
                <Button variant="ghost" size="xs" onClick={toggleExpanded}>
                    {expanded ? 'Show less' : 'Show full content'}
                </Button>
            )}
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
            {!expandable && preview.editable && <Badge tone="info">editable</Badge>}
        </div>
    );
}

/**
 * Map a destination delivery status to a Badge tone, so an operator reads where
 * approved content landed at a glance: delivered succeeds, failed alarms, refused
 * warns (the sink deliberately declined — not an error to chase, but not a
 * delivery either), pending is neutral (the leg was committed but not yet
 * settled).
 *
 * @param status - The per-destination delivery status.
 * @returns The Badge tone for that status.
 */
function outcomeTone(status: ICurationDestinationOutcome['status']): 'success' | 'danger' | 'warning' | 'neutral' {
    if (status === 'delivered') {
        return 'success';
    }
    if (status === 'failed') {
        return 'danger';
    }
    return status === 'refused' ? 'warning' : 'neutral';
}

/**
 * Render the per-destination delivery outcomes of an approved item as toned
 * badges — the audit of which publish sinks a curator's approval reached, which
 * failed, and which the sink refused. A failed leg carries its error and a
 * refused leg its reason in the badge's `title`, so the detail is one hover away
 * without cluttering the row. Renders nothing when the item fanned out to no
 * destinations (a classic single-effect approval).
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
                    <span title={outcome.error ?? outcome.reason}>{outcome.sinkId}: {outcome.status}</span>
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
 * One sink rendered as a labelled checkbox row inside the destination picker.
 * The exposure icon and the reach badge are toned to the row's group — a lock
 * and a neutral badge for internal, a globe and a warning badge for external —
 * so an external destination never visually reads as calm.
 *
 * @param props.dest - The eligible destination to render.
 * @param props.external - Whether this row belongs to the external/public group.
 * @param props.checked - Whether the sink is in the current selection.
 * @param props.disabled - Whether the input is locked (a decision is in flight).
 * @param props.onToggle - Toggle this sink's membership in the selection.
 * @returns The destination option row.
 */
function DestinationOption({ dest, external, checked, disabled, onToggle }: {
    dest: ICurationEligibleDestination;
    external: boolean;
    checked: boolean;
    disabled: boolean;
    onToggle: (sinkId: string) => void;
}) {
    return (
        <label className={styles.dest_option}>
            <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onToggle(dest.sinkId)}
            />
            {external
                ? <Globe size={14} aria-hidden className={styles.dest_icon} />
                : <Lock size={14} aria-hidden className={styles.dest_icon} />}
            <span className={styles.dest_label} title={dest.label ?? dest.sinkId}>{dest.label ?? dest.sinkId}</span>
            <Badge tone={external ? 'warning' : 'neutral'}>{dest.reach.egress}/{dest.reach.audience}</Badge>
        </label>
    );
}

/**
 * The destination picker for a held item that publishes to destinations. The
 * sinks are split into an internal/admin group and an external/public group so
 * the exposure of each choice is preattentive — a lock and a calm row versus a
 * globe, an amber panel, and a warning-toned reach badge — rather than text the
 * eye has to parse. A live summary names how many internal and external sinks
 * the current selection will fire, the same count the confirmation gate keys
 * off, so the operator sees the blast radius before committing.
 *
 * @param props.destinations - The item's eligible publish destinations.
 * @param props.selected - The currently selected sink ids.
 * @param props.busy - Whether this item's decision is in flight (locks inputs).
 * @param props.onToggle - Toggle one sink's membership in the selection.
 * @param props.onSetDefault - Persist the current selection as the type's default.
 * @returns The grouped destination picker.
 */
function DestinationPicker({ destinations, selected, busy, onToggle, onSetDefault }: {
    destinations: ICurationEligibleDestination[];
    selected: Set<string>;
    busy: boolean;
    onToggle: (sinkId: string) => void;
    onSetDefault: () => void;
}) {
    const internal = destinations.filter(dest => !destinationIsExternal(dest.reach));
    const external = destinations.filter(dest => destinationIsExternal(dest.reach));
    const selectedInternal = internal.filter(dest => selected.has(dest.sinkId)).length;
    const selectedExternal = external.filter(dest => selected.has(dest.sinkId)).length;

    return (
        <fieldset className={styles.picker}>
            <legend className={styles.picker_legend}>Publish to</legend>
            {internal.length > 0 && (
                <div className={styles.picker_group}>
                    <div className={styles.picker_group_title}>Internal / Admin</div>
                    {internal.map(dest => (
                        <DestinationOption
                            key={dest.sinkId}
                            dest={dest}
                            external={false}
                            checked={selected.has(dest.sinkId)}
                            disabled={busy}
                            onToggle={onToggle}
                        />
                    ))}
                </div>
            )}
            {external.length > 0 && (
                <div className={`${styles.picker_group} ${styles.picker_group_external}`}>
                    <div className={styles.picker_group_title}>External / Public</div>
                    {external.map(dest => (
                        <DestinationOption
                            key={dest.sinkId}
                            dest={dest}
                            external
                            checked={selected.has(dest.sinkId)}
                            disabled={busy}
                            onToggle={onToggle}
                        />
                    ))}
                </div>
            )}
            <div className={styles.publish_summary}>
                {selectedInternal === 0 && selectedExternal === 0
                    ? 'No destinations selected'
                    : (
                        <>
                            {selectedExternal > 0 && <AlertTriangle size={14} aria-hidden className={styles.summary_warn} />}
                            Publishing to {selectedInternal} internal · {selectedExternal} external
                        </>
                    )}
            </div>
            <Button variant="ghost" size="xs" disabled={busy} onClick={onSetDefault}>
                Set as default for this type
            </Button>
        </fieldset>
    );
}

/**
 * The decision rail of a pending review card: the destination picker (when the
 * item's type publishes to destinations and sinks are eligible) plus the Approve
 * / Edit / Reject actions. The eligible destinations are SECONDARY data, lazily
 * fetched per card after mount, so they never block the queue render; an item
 * with no eligible destinations shows the plain Approve action unchanged. The
 * selection seeds from standing policy (`defaultSelected`) — the operator's saved
 * per-type default — which the curator confirms or overrides before approving,
 * the human gate doubling as the mandated-subset selector. An approval whose
 * selection includes any external/public sink is routed through a confirmation
 * modal first; internal-only approval and rejection commit immediately.
 *
 * @param props.item - The pending curation envelope.
 * @param props.busyId - The id of the card currently deciding, or null.
 * @param props.onApprove - Approve the item with the curator's selected destinations.
 * @param props.onReject - Reject the item.
 * @param props.onEdit - Open the inline editor for the item.
 * @param props.onSetDefault - Save the current selection as the type's default.
 * @returns The decision rail controls.
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
    const { open, close } = useModal();

    // Fetch the item's eligible destinations once after mount and seed the
    // selection from standing policy. A `cancelled` guard drops a late resolve if
    // the card unmounts (e.g. the queue refetched) so it cannot set stale state.
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
    // Eligibility is unknown until this card's fetch settles (destinations === null);
    // block approval during that window so a fast click cannot take the classic
    // path and silently skip the publish destinations the picker would have selected.
    const destinationsLoading = destinations === null;
    // A destinations-enabled item must target at least one sink: approving with an
    // empty selection would commit the decision while publishing nowhere — a silent
    // no-op the operator did not intend. Block Approve until a destination is picked.
    const noDestinationSelected = hasPicker && selected.size === 0;

    // The external/public sinks in the current selection — the channels the
    // confirmation gate names, and the test for whether the gate fires at all.
    const selectedExternal = useMemo(
        () => (destinations ?? []).filter(dest => selected.has(dest.sinkId) && destinationIsExternal(dest.reach)),
        [destinations, selected]
    );

    // Commit the approval with the curator's selection (or undefined when there
    // is no picker, preserving the classic single-effect approve).
    const commitApprove = useCallback(() => {
        const approveDestinations = hasPicker
            ? Array.from(selected).map((sinkId): ICurationDestinationSelection => ({ sinkId }))
            : undefined;
        onApprove(item.id, approveDestinations);
    }, [hasPicker, selected, onApprove, item.id]);

    // Approve, but gate any external/public fan-out behind explicit confirmation.
    // Internal-only approvals (and items with no picker) commit immediately — the
    // friction lands only where the effect is irreversible.
    const handleApprove = useCallback(() => {
        if (selectedExternal.length === 0) {
            commitApprove();
            return;
        }
        const modalId = `curation-publish-${item.id}`;
        open({
            id: modalId,
            title: 'Confirm external publish',
            size: 'sm',
            content: (
                <PublishConfirm
                    channels={selectedExternal}
                    onCancel={() => close(modalId)}
                    onConfirm={() => { close(modalId); commitApprove(); }}
                />
            )
        });
    }, [selectedExternal, commitApprove, open, close, item.id]);

    return (
        <Stack gap="md">
            {destinationsLoading && <div className={styles.rail_hint}>Loading destinations…</div>}
            {hasPicker && (
                <DestinationPicker
                    destinations={destinations}
                    selected={selected}
                    busy={busy}
                    onToggle={toggle}
                    onSetDefault={() => onSetDefault(item.id, Array.from(selected))}
                />
            )}
            <div className={styles.actions}>
                <Button variant="primary" size="sm" loading={busy} disabled={blockedByOther || destinationsLoading || noDestinationSelected} onClick={handleApprove}>
                    <Check size={16} /> Approve
                </Button>
                {item.preview.editable && (
                    <Button variant="secondary" size="sm" disabled={busyId !== null} onClick={() => onEdit(item)}>
                        <Pencil size={16} /> Edit
                    </Button>
                )}
                <Button variant="danger" size="sm" className={styles.action_reject} loading={busy} disabled={blockedByOther} onClick={() => onReject(item.id)}>
                    <X size={16} /> Reject
                </Button>
            </div>
        </Stack>
    );
}

/**
 * One pending item as a focused review card: the content (title, provider/source
 * metadata, held-since, and the expandable preview) beside a decision rail. The
 * two-region split gives the content readable width and hands the destination
 * picker a column of its own, the room the old table cell never had — which is
 * why the multilingual sink labels no longer wrap to eight lines. On a narrow
 * container the regions stack, the rail dropping below the content.
 *
 * @param props.item - The pending curation envelope.
 * @param props.busyId - The id of the card currently deciding, or null.
 * @param props.onApprove - Approve the item with the curator's selected destinations.
 * @param props.onReject - Reject the item.
 * @param props.onEdit - Open the inline editor for the item.
 * @param props.onSetDefault - Save the current selection as the type's default.
 * @returns The review card.
 */
function PendingCard({ item, busyId, onApprove, onReject, onEdit, onSetDefault }: {
    item: ICurationItemView;
    busyId: string | null;
    onApprove: (id: string, destinations?: ICurationDestinationSelection[]) => void;
    onReject: (id: string) => void;
    onEdit: (item: ICurationItemView) => void;
    onSetDefault: (id: string, sinkIds: string[]) => void;
}) {
    return (
        <Card padding="lg" className={styles.review_card}>
            <div className={styles.review_grid}>
                <div className={styles.review_content}>
                    <div className={styles.review_meta}>
                        <div className={styles.review_meta_head}>
                            <span className={styles.review_title}>{item.preview.title ?? item.typeId}</span>
                            {item.preview.editable && <Badge tone="info">editable</Badge>}
                        </div>
                        <div className={styles.review_submeta}>
                            {item.providerId}{item.source ? ` · ${item.source}` : ''} · held <ClientTime date={item.createdAt} format="datetime" />
                        </div>
                    </div>
                    <CurationPreview preview={item.preview} expandable />
                </div>
                <div className={styles.review_rail}>
                    <PendingActions
                        item={item}
                        busyId={busyId}
                        onApprove={onApprove}
                        onReject={onReject}
                        onEdit={onEdit}
                        onSetDefault={onSetDefault}
                    />
                </div>
            </div>
        </Card>
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
                    ? <div className={styles.placeholder}>{isHistory ? 'No curation decisions yet.' : 'Queue clear — nothing awaiting review.'}</div>
                    : isHistory
                        ? (
                            <div className={`table-scroll ${styles.curation_table}`}>
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
                                                <Td muted data-label="Held"><ClientTime date={item.createdAt} format="datetime" /></Td>
                                                <Td data-label="Type">
                                                    <div className={styles.tool_name}>{item.preview.title ?? item.typeId}</div>
                                                    <div className={styles.tool_desc}>
                                                        {item.providerId}{item.source ? ` · ${item.source}` : ''}
                                                    </div>
                                                </Td>
                                                <Td data-label="Preview"><CurationPreview preview={item.preview} /></Td>
                                                <Td data-label="Decision"><CurationDecision item={item} /></Td>
                                            </Tr>
                                        ))}
                                    </Tbody>
                                </Table>
                            </div>
                        )
                        : (
                            <Stack gap="md">
                                {items.map(item => (
                                    <PendingCard
                                        key={item.id}
                                        item={item}
                                        busyId={busyId}
                                        onApprove={(id, destinations) => { void resolve(id, 'approve', destinations); }}
                                        onReject={(id) => { void resolve(id, 'reject'); }}
                                        onEdit={openEditor}
                                        onSetDefault={(id, sinkIds) => { void setDefault(id, sinkIds); }}
                                    />
                                ))}
                            </Stack>
                        )}
        </Stack>
    );
}
