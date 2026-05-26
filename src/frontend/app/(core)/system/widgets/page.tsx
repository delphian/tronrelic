'use client';

/**
 * @fileoverview Operator UI for widget placements.
 *
 * Renders a per-zone view of every placement that resolves to that
 * zone, grouped by zone host (site / core / plugin / admin). Each row
 * surfaces source (plugin vs operator), route filter, render order,
 * and an enabled switch, plus inline edit / delete / restore-defaults
 * actions. Create-placement opens a modal with a type picker, a zone
 * picker, and a route chip input that accepts exact paths or globs
 * (`/u/*`, `/admin/**`).
 *
 * Lives behind the System container, which is admin-gated. Like
 * `/system/menu` and `/system/hooks` this is a client component
 * because the page needs hooks (`useModal`, `useToast`, WebSocket
 * subscription, redux). Admin auth runs on the cookie path —
 * same-origin fetches carry the signed `tronrelic_uid` cookie, which
 * `requireAdmin` consults; `useSystemAuth().token` stays as an empty
 * string for transitional API compatibility. WebSocket subscription
 * to `widgets:placements-update` triggers a list refetch so admin
 * changes propagate live to every open admin tab.
 *
 * @module app/(core)/system/widgets/page
 */

import {
    useCallback,
    useEffect,
    useMemo,
    useState,
    type FormEvent,
    type KeyboardEvent
} from 'react';
import { GripVertical, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCorners,
    useDroppable,
    useSensor,
    useSensors,
    type DragEndEvent
} from '@dnd-kit/core';
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { IZoneSnapshot, IWidgetTypeSnapshot } from '@/types';

import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { Switch } from '../../../../components/ui/Switch';
import { useModal } from '../../../../components/ui/ModalProvider';
import { useToast } from '../../../../components/ui/ToastProvider';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useSystemAuth } from '../../../../features/system';
import { cn } from '../../../../lib/cn';
import { getSocket } from '../../../../lib/socketClient';

import styles from './page.module.scss';

/**
 * Public-facing placement record returned by the admin list endpoint.
 * Mirrors `IWidgetPlacement` from the backend types package but
 * declared inline here so the frontend module is self-contained.
 */
interface IPlacement {
    id: string;
    typeId: string;
    zoneId: string;
    routes: string[];
    order: number;
    title?: string;
    instanceConfig?: Record<string, unknown>;
    enabled: boolean;
    source: 'plugin' | 'operator';
    pluginId?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Patch shape sent to PATCH /placements/:id. `title: null` is the
 * explicit unset signal honored server-side as `$unset: { title }`.
 */
interface IPlacementPatch {
    zoneId?: string;
    routes?: string[];
    order?: number;
    title?: string | null | undefined;
    instanceConfig?: Record<string, unknown>;
    enabled?: boolean;
}

/**
 * Create-placement input. Matches the backend controller's
 * normalised body.
 */
interface IPlacementCreate {
    typeId: string;
    zoneId: string;
    routes: string[];
    order?: number;
    title?: string;
    instanceConfig?: Record<string, unknown>;
    enabled?: boolean;
}

/**
 * Build the standard `X-Admin-Token` header. Centralised so the
 * empty-token edge case (token cleared mid-session) yields a clean
 * 401 from the backend rather than a bare `undefined` cast.
 */
function authHeader(token: string | null): HeadersInit {
    return { 'X-Admin-Token': token ?? '' };
}

/**
 * Translate a placement source into a Badge tone.
 */
function sourceTone(source: IPlacement['source']): 'info' | 'success' {
    return source === 'plugin' ? 'info' : 'success';
}

/**
 * Flatten the structured 400 body the placement API returns into a
 * single human-readable message for the toast. Server-side schema
 * validation surfaces a top-level `error` plus an `errors: [{path,
 * message}]` array; we render `path: message` lines beneath the
 * summary so an operator typing JSON sees which field failed without
 * having to inspect the network tab.
 */
function formatApiError(
    body: { error?: string; errors?: ReadonlyArray<{ path?: string; message?: string }> },
    status: number,
    verb: string
): string {
    const summary = body.error || `${verb} failed (${status})`;
    if (!Array.isArray(body.errors) || body.errors.length === 0) return summary;
    const fields = body.errors
        .map(e => `${e.path?.length ? e.path : '/'}: ${e.message ?? 'invalid'}`)
        .join('; ');
    return `${summary} — ${fields}`;
}

/**
 * Type-snapshot lookup utility — returns the type's label and
 * declaring plugin id for rendering inside the table.
 */
function lookupType(snapshot: IWidgetTypeSnapshot | null, typeId: string): { label: string; pluginId: string } | null {
    if (!snapshot) return null;
    for (const group of snapshot.groups) {
        for (const type of group.types) {
            if (type.id === typeId) return { label: type.label, pluginId: group.pluginId };
        }
    }
    return null;
}

/**
 * Zone-snapshot lookup — returns the zone label so the table can
 * render human-readable zone names without dropping back to id.
 */
function lookupZone(snapshot: IZoneSnapshot | null, zoneId: string): { label: string; host: string } | null {
    if (!snapshot) return null;
    for (const track of snapshot.tracks) {
        for (const zone of track.zones) {
            if (zone.id === zoneId) return { label: zone.label, host: zone.host };
        }
    }
    return null;
}

/**
 * Top-level admin page rendering the placement editor.
 */
export default function WidgetsAdminPage() {
    const { token } = useSystemAuth();
    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    const [zones, setZones] = useState<IZoneSnapshot | null>(null);
    const [types, setTypes] = useState<IWidgetTypeSnapshot | null>(null);
    const [placements, setPlacements] = useState<IPlacement[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const headers = useMemo<HeadersInit>(() => authHeader(token), [token]);

    const notifyError = useCallback(
        (title: string, err: unknown) => {
            pushToast({
                tone: 'danger',
                title,
                description: err instanceof Error ? err.message : String(err)
            });
        },
        [pushToast]
    );

    const notifySuccess = useCallback(
        (title: string) => pushToast({ tone: 'success', title }),
        [pushToast]
    );

    /**
     * Fetch the three snapshots needed to render the page. The
     * loading flag is only set on first-load; refetches triggered by
     * WebSocket events do not flash a loading state.
     */
    const fetchAll = useCallback(
        async (firstLoad: boolean): Promise<void> => {
            if (firstLoad) setLoading(true);
            setError(null);
            try {
                const [zonesRes, typesRes, placementsRes] = await Promise.all([
                    fetch('/api/admin/system/zones', { headers }),
                    fetch('/api/admin/system/widget-types', { headers }),
                    fetch('/api/admin/system/widgets/placements', { headers })
                ]);
                if (!zonesRes.ok) throw new Error(`Failed to load zones (${zonesRes.status})`);
                if (!typesRes.ok) throw new Error(`Failed to load widget types (${typesRes.status})`);
                if (!placementsRes.ok) throw new Error(`Failed to load placements (${placementsRes.status})`);
                const [zonesData, typesData, placementsData] = await Promise.all([
                    zonesRes.json(),
                    typesRes.json(),
                    placementsRes.json()
                ]);
                setZones(zonesData as IZoneSnapshot);
                setTypes(typesData as IWidgetTypeSnapshot);
                setPlacements((placementsData.placements ?? []) as IPlacement[]);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            } finally {
                if (firstLoad) setLoading(false);
            }
        },
        [headers]
    );

    /* Initial load. */
    useEffect(() => {
        void fetchAll(true);
    }, [fetchAll]);

    /* WebSocket refetch trigger. */
    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void fetchAll(false); };
        socket.on('widgets:placements-update', handler);
        return () => {
            socket.off('widgets:placements-update', handler);
        };
    }, [fetchAll]);

    /**
     * PATCH a single placement, throwing on failure.
     *
     * The modal-edit path awaits this directly and lets the outer
     * try/catch handle the failure UX (toast + keep modal open). The
     * row-level enable switch goes through `togglePlacement` instead,
     * which adds the standalone toast UX.
     */
    const patchPlacement = useCallback(
        async (id: string, patch: IPlacementPatch): Promise<void> => {
            const res = await fetch(`/api/admin/system/widgets/placements/${id}`, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(patch)
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(formatApiError(body, res.status, 'Update'));
            }
        },
        [headers]
    );

    /**
     * Toast-wrapping wrapper for the inline enable switch and any
     * other standalone-row mutation. Toasts success or failure and
     * never throws, since the callers (Switch's `onChange`) have
     * nowhere to surface the error.
     */
    const togglePlacement = useCallback(
        async (id: string, patch: IPlacementPatch): Promise<void> => {
            setBusyId(id);
            try {
                await patchPlacement(id, patch);
                notifySuccess('Placement updated');
            } catch (err) {
                notifyError('Could not update placement', err);
            } finally {
                setBusyId(null);
            }
        },
        [patchPlacement, notifyError, notifySuccess]
    );

    /**
     * Create a new operator-source placement.
     */
    const createPlacement = useCallback(
        async (input: IPlacementCreate): Promise<void> => {
            const res = await fetch('/api/admin/system/widgets/placements', {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify(input)
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(formatApiError(body, res.status, 'Create'));
            }
        },
        [headers]
    );

    /**
     * Delete an operator-source placement.
     */
    const deletePlacement = useCallback(
        async (id: string): Promise<void> => {
            const res = await fetch(`/api/admin/system/widgets/placements/${id}`, {
                method: 'DELETE',
                headers
            });
            if (!res.ok && res.status !== 204) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error || `Delete failed (${res.status})`);
            }
        },
        [headers]
    );

    /**
     * Restore plugin defaults on a plugin-source placement.
     */
    const restoreDefaults = useCallback(
        async (id: string): Promise<void> => {
            setBusyId(id);
            try {
                const res = await fetch(`/api/admin/system/widgets/placements/${id}/restore-defaults`, {
                    method: 'POST',
                    headers
                });
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `Restore failed (${res.status})`);
                }
                notifySuccess('Plugin defaults restored');
            } catch (err) {
                notifyError('Could not restore defaults', err);
            } finally {
                setBusyId(null);
            }
        },
        [headers, notifyError, notifySuccess]
    );

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    /**
     * Persist a drag-end gesture. Within-zone drops reorder; cross-zone
     * drops additionally rewrite the moved placement's zoneId. Both
     * paths renumber positions sequentially (10, 20, 30…) and emit one
     * PATCH per placement whose order or zone actually changed. The
     * local placement list is updated optimistically so the bubble
     * snaps into place before the network round-trip resolves; a
     * failed PATCH falls back to a refetch.
     */
    const handleDragEnd = useCallback(
        async (event: DragEndEvent): Promise<void> => {
            const { active, over } = event;
            if (!over) return;
            const sourceZone = active.data.current?.zoneId as string | undefined;
            const destZone = (over.data.current?.zoneId as string | undefined) ?? String(over.id);
            if (!sourceZone || !destZone) return;
            if (active.id === over.id && sourceZone === destZone) return;

            const sameZone = sourceZone === destZone;
            const sourceList = placements
                .filter(p => p.zoneId === sourceZone)
                .sort((a, b) => a.order - b.order);
            const moved = sourceList.find(p => p.id === active.id);
            if (!moved) return;

            const sourceWithoutActive = sourceList.filter(p => p.id !== active.id);
            const destListPrev = sameZone
                ? sourceWithoutActive
                : placements
                    .filter(p => p.zoneId === destZone)
                    .sort((a, b) => a.order - b.order);

            const insertIdx =
                over.id === destZone
                    ? destListPrev.length
                    : (() => {
                        const target = destListPrev.findIndex(p => p.id === over.id);
                        return target < 0 ? destListPrev.length : target;
                    })();

            const newDest = [
                ...destListPrev.slice(0, insertIdx),
                sameZone ? moved : { ...moved, zoneId: destZone },
                ...destListPrev.slice(insertIdx)
            ];
            const newSource = sameZone ? newDest : sourceWithoutActive;

            interface IOp { id: string; patch: IPlacementPatch }
            const ops: IOp[] = [];
            const collect = (list: IPlacement[], rewriteZoneFor?: string): void => {
                list.forEach((p, idx) => {
                    const nextOrder = (idx + 1) * 10;
                    const patch: IPlacementPatch = {};
                    if (p.order !== nextOrder) patch.order = nextOrder;
                    if (rewriteZoneFor === p.id) patch.zoneId = destZone;
                    if (Object.keys(patch).length > 0) ops.push({ id: p.id, patch });
                });
            };
            collect(newSource);
            if (!sameZone) collect(newDest, moved.id);

            if (ops.length === 0) return;

            setPlacements(prev => {
                const byId = new Map(prev.map(p => [p.id, p]));
                for (const op of ops) {
                    const existing = byId.get(op.id);
                    if (!existing) continue;
                    byId.set(op.id, {
                        ...existing,
                        order: op.patch.order ?? existing.order,
                        zoneId: op.patch.zoneId ?? existing.zoneId
                    });
                }
                return Array.from(byId.values());
            });

            try {
                await Promise.all(ops.map(op => patchPlacement(op.id, op.patch)));
            } catch (err) {
                notifyError('Could not reorder placements', err);
                void fetchAll(false);
            }
        },
        [placements, patchPlacement, notifyError, fetchAll]
    );

    /**
     * Group placements by zone for rendering. Zones with no
     * placements still render so operators can see they exist.
     */
    const grouped = useMemo(() => {
        if (!zones) return [] as Array<{ trackId: string; trackLabel: string; rows: Array<{ zoneId: string; zoneLabel: string; placements: IPlacement[] }> }>;
        const byZone = new Map<string, IPlacement[]>();
        for (const placement of placements) {
            const bucket = byZone.get(placement.zoneId) ?? [];
            bucket.push(placement);
            byZone.set(placement.zoneId, bucket);
        }
        for (const bucket of byZone.values()) {
            bucket.sort((a, b) => a.order - b.order);
        }
        return zones.tracks.map(track => ({
            trackId: track.id,
            trackLabel: track.label,
            rows: track.zones.map(zone => ({
                zoneId: zone.id,
                zoneLabel: zone.label,
                placements: byZone.get(zone.id) ?? []
            }))
        }));
    }, [zones, placements]);

    /**
     * Open the create/edit form modal.
     */
    const openPlacementModal = useCallback(
        (mode: 'create' | 'edit', initial?: IPlacement) => {
            const id = openModal({
                title: mode === 'create' ? 'Place widget' : 'Edit widget',
                size: 'md',
                content: (
                    <PlacementForm
                        mode={mode}
                        initial={initial}
                        types={types}
                        zones={zones}
                        onCancel={() => closeModal(id)}
                        onSubmit={async (data) => {
                            try {
                                if (mode === 'create') {
                                    await createPlacement(data as IPlacementCreate);
                                    notifySuccess('Placement created');
                                } else if (initial) {
                                    await patchPlacement(initial.id, data as IPlacementPatch);
                                    notifySuccess('Placement updated');
                                }
                                closeModal(id);
                            } catch (err) {
                                notifyError(
                                    mode === 'create' ? 'Could not create placement' : 'Could not update placement',
                                    err
                                );
                            }
                        }}
                    />
                )
            });
        },
        [
            closeModal,
            createPlacement,
            notifyError,
            notifySuccess,
            openModal,
            patchPlacement,
            types,
            zones
        ]
    );

    /**
     * Open the delete-confirm modal. Plugin-source rows are not
     * deletable — the delete button is hidden for those, but if
     * somehow invoked the dialog explains the constraint.
     */
    const openDeleteModal = useCallback(
        (placement: IPlacement) => {
            const isPluginSource = placement.source === 'plugin';
            const id = openModal({
                title: 'Delete widget',
                size: 'sm',
                content: (
                    <ConfirmDialog
                        label={placement.title ?? placement.typeId}
                        message={
                            isPluginSource
                                ? 'Plugin-placed widgets cannot be deleted. Disable the widget or restore plugin defaults instead.'
                                : undefined
                        }
                        confirmLabel="Delete"
                        onCancel={() => closeModal(id)}
                        onConfirm={async () => {
                            if (isPluginSource) {
                                closeModal(id);
                                return;
                            }
                            try {
                                await deletePlacement(placement.id);
                                notifySuccess('Placement deleted');
                                closeModal(id);
                            } catch (err) {
                                notifyError('Could not delete placement', err);
                            }
                        }}
                    />
                )
            });
        },
        [closeModal, deletePlacement, notifyError, notifySuccess, openModal]
    );

    return (
        <Page>
            <div className={styles.container}>
                <PageHeader
                    title="Widget Placements"
                    subtitle="Where plugin widgets appear, in what order, and on which routes."
                />

                <Stack gap="lg">
                    <div className={styles.toolbar}>
                        <p className="text-muted">
                            Widgets reach a zone two ways. <strong>Plugin-placed</strong> rows are added
                            automatically by the plugin that owns the widget — you can disable or edit them,
                            and your changes survive the plugin being turned off and back on.
                            {' '}<strong>Operator-placed</strong> rows are ones you add here yourself with
                            {' '}<strong>Place widget</strong> — disable, edit, or delete them freely.
                        </p>
                        <Button
                            variant="primary"
                            icon={<Plus size={16} />}
                            onClick={() => openPlacementModal('create')}
                            disabled={!zones || !types}
                        >
                            Place widget
                        </Button>
                    </div>

                    {error && <div className="alert" role="alert">{error}</div>}

                    {loading && (
                        <p className="text-muted">Loading placement editor&hellip;</p>
                    )}

                    {!loading && grouped.length === 0 && (
                        <p className="text-muted">No zones declared.</p>
                    )}

                    {!loading && (
                        <DndContext
                            sensors={sensors}
                            collisionDetection={closestCorners}
                            onDragEnd={handleDragEnd}
                        >
                            {grouped.map(track => (
                                <section key={track.trackId} className={styles.track}>
                                    <h2 className={styles.track_title}>{track.trackLabel}</h2>
                                    <div className={styles.zone_list}>
                                        {track.rows.map(zone => (
                                            <ZoneSection
                                                key={zone.zoneId}
                                                zoneId={zone.zoneId}
                                                zoneLabel={zone.zoneLabel}
                                                placements={zone.placements}
                                                types={types}
                                                zones={zones}
                                                busyId={busyId}
                                                onToggleEnabled={(p, next) => togglePlacement(p.id, { enabled: next })}
                                                onEdit={(p) => openPlacementModal('edit', p)}
                                                onDelete={openDeleteModal}
                                                onRestore={(p) => restoreDefaults(p.id)}
                                            />
                                        ))}
                                    </div>
                                </section>
                            ))}
                        </DndContext>
                    )}
                </Stack>
            </div>
        </Page>
    );
}

/* ------------------------------------------------------------------ */
/* Zone section                                                        */
/* ------------------------------------------------------------------ */

interface ZoneSectionProps {
    zoneId: string;
    zoneLabel: string;
    placements: IPlacement[];
    types: IWidgetTypeSnapshot | null;
    zones: IZoneSnapshot | null;
    busyId: string | null;
    onToggleEnabled: (placement: IPlacement, next: boolean) => void;
    onEdit: (placement: IPlacement) => void;
    onDelete: (placement: IPlacement) => void;
    onRestore: (placement: IPlacement) => void;
}

function ZoneSection({
    zoneId,
    zoneLabel,
    placements,
    types,
    zones,
    busyId,
    onToggleEnabled,
    onEdit,
    onDelete,
    onRestore
}: ZoneSectionProps) {
    const zoneInfo = lookupZone(zones, zoneId);
    const { setNodeRef, isOver } = useDroppable({ id: zoneId, data: { zoneId } });
    const itemIds = useMemo(() => placements.map(p => p.id), [placements]);

    return (
        <section className={cn(styles.zone, isOver && styles['zone--drop-target'])}>
            <header className={styles.zone_header}>
                <h3 className={styles.zone_label}>
                    {zoneLabel}
                    <span className={styles.zone_id}>{zoneId}</span>
                </h3>
                {zoneInfo && <Badge tone="neutral">{zoneInfo.host}</Badge>}
                <span className={styles.zone_count}>
                    {placements.length} {placements.length === 1 ? 'placement' : 'placements'}
                </span>
            </header>

            <SortableContext id={zoneId} items={itemIds} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className={styles.bubbles}>
                    {placements.length === 0 ? (
                        <p className={styles.zone_empty}>
                            No placements in this zone — drag a widget here to place it.
                        </p>
                    ) : (
                        placements.map(placement => (
                            <PlacementBubble
                                key={placement.id}
                                placement={placement}
                                typeInfo={lookupType(types, placement.typeId)}
                                busy={busyId === placement.id}
                                onToggleEnabled={onToggleEnabled}
                                onEdit={onEdit}
                                onDelete={onDelete}
                                onRestore={onRestore}
                            />
                        ))
                    )}
                </div>
            </SortableContext>
        </section>
    );
}

/* ------------------------------------------------------------------ */
/* Placement bubble                                                    */
/* ------------------------------------------------------------------ */

interface PlacementBubbleProps {
    placement: IPlacement;
    typeInfo: { label: string; pluginId: string } | null;
    busy: boolean;
    onToggleEnabled: (placement: IPlacement, next: boolean) => void;
    onEdit: (placement: IPlacement) => void;
    onDelete: (placement: IPlacement) => void;
    onRestore: (placement: IPlacement) => void;
}

/**
 * Single draggable placement card. The grip on the left is the drag
 * activator; the rest of the card stays clickable for the inline
 * switch and action buttons. Order and last-updated are intentionally
 * hidden — both remain editable from the modal opened via the pencil
 * icon.
 */
function PlacementBubble({
    placement,
    typeInfo,
    busy,
    onToggleEnabled,
    onEdit,
    onDelete,
    onRestore
}: PlacementBubbleProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: placement.id,
        data: { zoneId: placement.zoneId }
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition
    };

    const label = placement.title ?? typeInfo?.label ?? placement.typeId;

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(styles.bubble, isDragging && styles['bubble--dragging'])}
        >
            <button
                type="button"
                className={styles.bubble_handle}
                aria-label={`Drag ${label} to reorder`}
                {...attributes}
                {...listeners}
            >
                <GripVertical size={16} aria-hidden />
            </button>
            <div className={styles.bubble_main}>
                <div className={styles.bubble_top}>
                    <span className={styles.widget_label}>{label}</span>
                    <Badge tone={sourceTone(placement.source)}>
                        {placement.source === 'plugin'
                            ? `plugin: ${placement.pluginId ?? '?'}`
                            : 'operator'}
                    </Badge>
                </div>
                <span className={styles.widget_meta}>
                    {placement.typeId}
                    {typeInfo && ` · ${typeInfo.pluginId}`}
                </span>
                <div className={styles.bubble_routes}>
                    {placement.routes.length === 0
                        ? <em className={styles.bubble_routes_empty}>every route</em>
                        : placement.routes.map(r => (
                            <code key={r} className={styles.route_chip}>{r}</code>
                        ))}
                </div>
            </div>
            <div className={styles.bubble_actions}>
                <Switch
                    size="sm"
                    on={placement.enabled}
                    onChange={(next) => onToggleEnabled(placement, next)}
                    disabled={busy}
                    aria-label={`${placement.enabled ? 'Disable' : 'Enable'} placement ${label}`}
                />
                <IconButton
                    size="sm"
                    variant="primary"
                    aria-label={`Edit ${label}`}
                    onClick={() => onEdit(placement)}
                >
                    <Pencil size={14} />
                </IconButton>
                {placement.source === 'plugin' ? (
                    <IconButton
                        size="sm"
                        variant="ghost"
                        aria-label={`Restore plugin defaults for ${label}`}
                        onClick={() => onRestore(placement)}
                        disabled={busy}
                    >
                        <RefreshCw size={14} />
                    </IconButton>
                ) : (
                    <IconButton
                        size="sm"
                        variant="danger"
                        aria-label={`Delete ${label}`}
                        onClick={() => onDelete(placement)}
                    >
                        <Trash2 size={14} />
                    </IconButton>
                )}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Placement form (create + edit)                                      */
/* ------------------------------------------------------------------ */

interface PlacementFormProps {
    mode: 'create' | 'edit';
    initial?: IPlacement;
    types: IWidgetTypeSnapshot | null;
    zones: IZoneSnapshot | null;
    onSubmit: (data: IPlacementCreate | IPlacementPatch) => Promise<void>;
    onCancel: () => void;
}

function PlacementForm({ mode, initial, types, zones, onSubmit, onCancel }: PlacementFormProps) {
    const [typeId, setTypeId] = useState<string>(initial?.typeId ?? '');
    const [zoneId, setZoneId] = useState<string>(initial?.zoneId ?? '');
    const [routes, setRoutes] = useState<string[]>(initial?.routes ?? []);
    const [routeDraft, setRouteDraft] = useState<string>('');
    const [order, setOrder] = useState<number>(initial?.order ?? 100);
    const [title, setTitle] = useState<string>(initial?.title ?? '');
    const [enabled, setEnabled] = useState<boolean>(initial?.enabled ?? true);
    const [saving, setSaving] = useState<boolean>(false);
    const [routeError, setRouteError] = useState<string | null>(null);
    // Per-placement instanceConfig surface. Pre-populate edit-mode rows
    // with the existing config (pretty-printed); leave create-mode blank
    // so an operator who doesn't need overrides just submits empty —
    // the parser treats blank as "no instanceConfig in payload".
    const [instanceConfigText, setInstanceConfigText] = useState<string>(
        initial?.instanceConfig
            ? JSON.stringify(initial.instanceConfig, null, 2)
            : ''
    );
    const [instanceConfigError, setInstanceConfigError] = useState<string | null>(null);

    const handleAddRoute = useCallback(() => {
        const trimmed = routeDraft.trim();
        if (trimmed.length === 0) return;
        if (!trimmed.startsWith('/')) {
            setRouteError('Patterns must start with /');
            return;
        }
        if (/\s/.test(trimmed)) {
            setRouteError('Patterns cannot contain whitespace');
            return;
        }
        if (routes.includes(trimmed)) {
            setRouteError('Pattern already added');
            return;
        }
        setRoutes(prev => [...prev, trimmed]);
        setRouteDraft('');
        setRouteError(null);
    }, [routeDraft, routes]);

    const handleRouteKey = useCallback(
        (e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                handleAddRoute();
            }
        },
        [handleAddRoute]
    );

    const handleRemoveRoute = useCallback((entry: string) => {
        setRoutes(prev => prev.filter(r => r !== entry));
    }, []);

    const handleSubmit = useCallback(
        async (e: FormEvent) => {
            e.preventDefault();

            // Parse instanceConfig out of the textarea. Empty input
            // collapses to `undefined` so the payload omits the field
            // entirely (no change on patch, no overrides on create);
            // any other input must parse to a plain JSON object. Array
            // and primitive parses are rejected client-side rather
            // than relying on the server's shape-only guard so the
            // operator sees the failure inline.
            const rawConfig = instanceConfigText.trim();
            let parsedInstanceConfig: Record<string, unknown> | undefined;
            if (rawConfig.length > 0) {
                try {
                    const candidate = JSON.parse(rawConfig);
                    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
                        setInstanceConfigError('Instance config must be a JSON object');
                        return;
                    }
                    parsedInstanceConfig = candidate as Record<string, unknown>;
                } catch (err) {
                    setInstanceConfigError(
                        err instanceof Error ? `Invalid JSON: ${err.message}` : 'Invalid JSON'
                    );
                    return;
                }
            }
            setInstanceConfigError(null);

            setSaving(true);
            try {
                if (mode === 'create') {
                    const payload: IPlacementCreate = {
                        typeId,
                        zoneId,
                        routes,
                        order,
                        title: title.trim().length > 0 ? title.trim() : undefined,
                        instanceConfig: parsedInstanceConfig,
                        enabled
                    };
                    await onSubmit(payload);
                } else {
                    const trimmedTitle = title.trim();
                    const hadInitialTitle = typeof initial?.title === 'string' && initial.title.length > 0;
                    // Edit-mode title semantics:
                    //   - non-empty input → set the new value
                    //   - blank input when the row HAD a title → null
                    //     (explicit clear signal honored as $unset)
                    //   - blank input when the row had no title →
                    //     omit so the patch is a no-op for that field
                    const titlePatch: string | null | undefined =
                        trimmedTitle.length > 0
                            ? trimmedTitle
                            : hadInitialTitle
                                ? null
                                : undefined;
                    const payload: IPlacementPatch = {
                        zoneId,
                        routes,
                        order,
                        title: titlePatch,
                        instanceConfig: parsedInstanceConfig,
                        enabled
                    };
                    await onSubmit(payload);
                }
            } finally {
                setSaving(false);
            }
        },
        [enabled, initial?.title, instanceConfigText, mode, onSubmit, order, routes, title, typeId, zoneId]
    );

    const canSubmit = typeId.length > 0 && zoneId.length > 0;

    return (
        <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
                <label htmlFor="wp-type">Widget type</label>
                <select
                    id="wp-type"
                    className={styles.select}
                    value={typeId}
                    onChange={(e) => setTypeId(e.target.value)}
                    disabled={mode === 'edit' || saving}
                    required
                >
                    <option value="">Select a type&hellip;</option>
                    {types?.groups.map(group => (
                        <optgroup key={group.pluginId} label={group.pluginId}>
                            {group.types.map(t => (
                                <option key={t.id} value={t.id}>{t.label} ({t.id})</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
                {mode === 'edit' && (
                    <span className={styles.field_hint}>
                        Type is fixed for existing placements — create a new placement to use a different type.
                    </span>
                )}
            </div>

            <div className={styles.field}>
                <label htmlFor="wp-zone">Zone</label>
                <select
                    id="wp-zone"
                    className={styles.select}
                    value={zoneId}
                    onChange={(e) => setZoneId(e.target.value)}
                    disabled={saving}
                    required
                >
                    <option value="">Select a zone&hellip;</option>
                    {zones?.tracks.map(track => (
                        <optgroup key={track.id} label={track.label}>
                            {track.zones.map(z => (
                                <option key={z.id} value={z.id}>{z.label} ({z.id})</option>
                            ))}
                        </optgroup>
                    ))}
                </select>
            </div>

            <div className={styles.field}>
                <label htmlFor="wp-routes">Routes</label>
                <div className={styles.routes_chips}>
                    {routes.length === 0 && (
                        <span className={styles.field_hint}>Leave empty to render on every route.</span>
                    )}
                    {routes.map(entry => (
                        <span key={entry} className={styles.route_chip_editable}>
                            <code>{entry}</code>
                            <button
                                type="button"
                                aria-label={`Remove ${entry}`}
                                onClick={() => handleRemoveRoute(entry)}
                                disabled={saving}
                                className={styles.route_chip_remove}
                            >
                                <X size={12} aria-hidden />
                            </button>
                        </span>
                    ))}
                </div>
                <div className={styles.routes_input_row}>
                    <Input
                        id="wp-routes"
                        value={routeDraft}
                        onChange={(e) => { setRouteDraft(e.target.value); setRouteError(null); }}
                        onKeyDown={handleRouteKey}
                        placeholder="/u/* or /markets or /admin/**"
                        disabled={saving}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleAddRoute}
                        disabled={saving || routeDraft.trim().length === 0}
                    >
                        Add
                    </Button>
                </div>
                {routeError && <span className={styles.field_error}>{routeError}</span>}
                <span className={styles.field_hint}>
                    Press Enter or comma to add. Use <code>/u/*</code> for a single segment,
                    {' '}<code>/u/**</code> for any depth.
                </span>
            </div>

            <div className={styles.field_row}>
                <div className={styles.field}>
                    <label htmlFor="wp-order">Order</label>
                    <Input
                        id="wp-order"
                        type="number"
                        min={0}
                        max={10000}
                        value={order}
                        onChange={(e) => setOrder(parseInt(e.target.value, 10) || 0)}
                        disabled={saving}
                    />
                </div>
                <div className={styles.field}>
                    <label htmlFor="wp-title">Title override</label>
                    <Input
                        id="wp-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Optional"
                        maxLength={80}
                        disabled={saving}
                    />
                </div>
            </div>

            <div className={styles.field}>
                <label htmlFor="wp-instance-config">Instance config</label>
                <textarea
                    id="wp-instance-config"
                    className={styles.textarea}
                    rows={6}
                    value={instanceConfigText}
                    onChange={(e) => { setInstanceConfigText(e.target.value); setInstanceConfigError(null); }}
                    placeholder='{"maxPosts": 5}'
                    disabled={saving}
                    spellCheck={false}
                    aria-describedby="wp-instance-config-hint"
                />
                {instanceConfigError && <span className={styles.field_error}>{instanceConfigError}</span>}
                <span id="wp-instance-config-hint" className={styles.field_hint}>
                    Optional per-placement JSON object validated against the widget type&apos;s schema
                    on save. Leave empty for no overrides.
                </span>
            </div>

            <label className={styles.inline_toggle}>
                <Switch
                    size="sm"
                    on={enabled}
                    onChange={setEnabled}
                    disabled={saving}
                    aria-label="Enabled"
                />
                <span>Enabled</span>
            </label>

            <div className={styles.form_footer}>
                <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
                <Button type="submit" variant="primary" loading={saving} disabled={!canSubmit}>
                    {mode === 'create' ? 'Place widget' : 'Save changes'}
                </Button>
            </div>
        </form>
    );
}
