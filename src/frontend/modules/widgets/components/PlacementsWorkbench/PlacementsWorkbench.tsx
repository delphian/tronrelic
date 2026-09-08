'use client';

/**
 * @fileoverview The placement editor: library and page picker on one side,
 * the zone board on the other, and a slide-over for adding or editing a
 * single placement.
 *
 * One drag context spans both columns so a widget can be dragged from the
 * library straight onto a zone, a gap between rows, or a layout group. A
 * drop only decides where the new row lands; the editor opens to finish it,
 * because many widgets have required settings that a blind create would
 * fail on. Existing rows drag between and within zones as before.
 *
 * @module modules/widgets/components/PlacementsWorkbench
 */

import { useCallback, useMemo, useState } from 'react';
import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    PointerSensor,
    closestCorners,
    pointerWithin,
    useSensor,
    useSensors,
    type DragEndEvent,
    type DragStartEvent
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { AlertCircle, Plus } from 'lucide-react';
import type { IPlacementInput, IPlacementPatch, IWidgetPlacement } from '@/types';
import { Button } from '../../../../components/ui/Button';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../components/ui/ModalProvider';
import { SlideOver } from '../../../../components/ui/SlideOver';
import { useToast } from '../../../../components/ui/ToastProvider';
import { usePlacementsWorkbench } from '../../hooks/usePlacementsWorkbench';
import { findWidgetType, placementLabel, providerLabel } from '../../lib/placementLookup';
import type { EditorTarget } from '../../types/IEditorTarget';
import type { IWidgetsAdminData } from '../../types/IWidgetsAdminData';
import { PagePicker } from '../PagePicker';
import { PlacementEditor } from '../PlacementEditor';
import { WidgetLibrary, LIBRARY_DRAG_PREFIX, type ILibraryDragData } from '../WidgetLibrary';
import { ZoneBoard } from '../ZoneBoard';
import styles from './PlacementsWorkbench.module.scss';

/**
 * Props for the workbench.
 */
export interface IPlacementsWorkbenchProps {
    /** The server-fetched bundle that seeds the editor. */
    initial: IWidgetsAdminData;
}

/**
 * Where a zone track renders, as a note under its heading.
 *
 * @param hostId - The track's host id.
 * @returns A short sentence.
 */
function trackNote(hostId: string): string {
    let note = 'Rendered on admin pages.';
    if (hostId === 'site') note = 'Rendered on every page of the site.';
    if (hostId === 'core') note = 'Rendered on core pages only, around the main content.';
    if (hostId === 'plugin') note = 'Rendered on pages provided by plugins, around their content.';
    return note;
}

/**
 * The editor.
 *
 * @param props - See {@link IPlacementsWorkbenchProps}.
 * @returns The two-column workbench.
 */
export function PlacementsWorkbench({ initial }: IPlacementsWorkbenchProps) {
    const workbench = usePlacementsWorkbench(initial);
    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();
    const [editor, setEditor] = useState<EditorTarget | null>(null);
    const [draggingTypeId, setDraggingTypeId] = useState<string | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    /**
     * Let the thin gap rails win over the layout-group region they sit
     * beside. A group's region wraps the space directly under its row, so
     * `closestCorners` alone would resolve a drop just below the group to
     * the group itself. A rail claims a drop only when the pointer is
     * inside it, so it is checked first.
     *
     * @param args - dnd-kit collision arguments.
     * @returns The rail hit when inside one, else the closest-corners result.
     */
    const collisionDetection = useCallback((args: Parameters<typeof closestCorners>[0]) => {
        const gapHit = pointerWithin(args).find(hit => String(hit.id).startsWith('gap:'));
        return gapHit ? [gapHit] : closestCorners(args);
    }, []);

    const counts = useMemo(() => {
        const map = new Map<string, number>();
        for (const placement of workbench.placements) {
            map.set(placement.typeId, (map.get(placement.typeId) ?? 0) + 1);
        }
        return map;
    }, [workbench.placements]);

    const placementsByZone = useMemo(() => {
        const map = new Map<string, IWidgetPlacement[]>();
        for (const placement of workbench.placements) {
            const bucket = map.get(placement.zoneId) ?? [];
            bucket.push(placement);
            map.set(placement.zoneId, bucket);
        }
        return map;
    }, [workbench.placements]);

    const defaultRoutes = useMemo(
        () => (workbench.selectedRoute ? [workbench.selectedRoute] : []),
        [workbench.selectedRoute]
    );

    /**
     * Open the editor to add a widget, seeded with whatever the gesture knew.
     *
     * @param seed - Type, zone, container, and position already decided.
     */
    const openCreate = useCallback((seed: Omit<Extract<EditorTarget, { mode: 'create' }>, 'mode' | 'routes'>) => {
        setEditor({ mode: 'create', routes: defaultRoutes, ...seed });
    }, [defaultRoutes]);

    const openEdit = useCallback((placement: IWidgetPlacement) => {
        setEditor({ mode: 'edit', placement });
    }, []);

    const closeEditor = useCallback(() => setEditor(null), []);

    const handleDragStart = useCallback((event: DragStartEvent) => {
        const data = event.active.data.current as ILibraryDragData | undefined;
        setDraggingTypeId(data?.kind === 'library' ? data.typeId : null);
    }, []);

    /**
     * A library drop opens the editor at the drop position; a row drop
     * moves the row.
     *
     * @param event - The drag-end event.
     */
    const handleDragEnd = useCallback(async (event: DragEndEvent) => {
        setDraggingTypeId(null);
        const activeId = String(event.active.id);
        if (activeId.startsWith(LIBRARY_DRAG_PREFIX)) {
            const position = workbench.resolveInsertPosition(event.over);
            if (position) {
                openCreate({
                    typeId: activeId.slice(LIBRARY_DRAG_PREFIX.length),
                    zoneId: position.zoneId,
                    parentId: position.parentId ?? undefined,
                    position
                });
            }
        } else {
            await workbench.dropPlacement(event);
        }
    }, [workbench, openCreate]);

    const handleCreate = useCallback(async (input: IPlacementInput) => {
        const position = editor?.mode === 'create' ? editor.position ?? null : null;
        await workbench.createPlacementAt(input, position);
        setEditor(null);
    }, [editor, workbench]);

    const handleSave = useCallback(async (id: string, patch: IPlacementPatch) => {
        await workbench.savePlacement(id, patch);
        setEditor(null);
    }, [workbench]);

    /**
     * Confirm and remove an operator row.
     *
     * @param placement - The row to remove.
     */
    const confirmRemove = useCallback((placement: IWidgetPlacement) => {
        const label = placementLabel(placement, workbench.types);
        const id = openModal({
            title: 'Remove widget',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={label}
                    message={<>Remove <strong>{label}</strong> from {placement.zoneId}? Its settings are lost. Turn it off instead if you may want it back.</>}
                    confirmLabel="Remove"
                    onCancel={() => closeModal(id)}
                    onConfirm={async () => {
                        try {
                            await workbench.removePlacement(placement.id);
                            closeModal(id);
                            setEditor(null);
                        } catch (error) {
                            pushToast({ tone: 'danger', title: 'Could not remove the widget', description: error instanceof Error ? error.message : String(error) });
                        }
                    }}
                />
            )
        });
    }, [openModal, closeModal, workbench, pushToast]);

    /**
     * Confirm and restore a plugin row to its registered defaults. This
     * overwrites every operator change on the row, so it asks first.
     *
     * @param placement - The plugin row to reset.
     */
    const confirmRestore = useCallback((placement: IWidgetPlacement) => {
        const label = placementLabel(placement, workbench.types);
        const id = openModal({
            title: 'Restore plugin defaults',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={label}
                    message={<>Reset <strong>{label}</strong> to what its plugin registered? Your zone, pages, heading, and settings changes on this row are discarded.</>}
                    confirmLabel="Restore"
                    onCancel={() => closeModal(id)}
                    onConfirm={async () => {
                        try {
                            await workbench.restorePlacement(placement.id);
                            closeModal(id);
                            setEditor(null);
                        } catch (error) {
                            pushToast({ tone: 'danger', title: 'Could not restore defaults', description: error instanceof Error ? error.message : String(error) });
                        }
                    }}
                />
            )
        });
    }, [openModal, closeModal, workbench, pushToast]);

    const draggingType = draggingTypeId ? findWidgetType(workbench.types, draggingTypeId) : undefined;
    const ready = workbench.zones !== null && workbench.types !== null;
    const editingLabel = editor?.mode === 'edit' ? placementLabel(editor.placement, workbench.types) : 'Add widget';
    const editingType = editor?.mode === 'edit' ? findWidgetType(workbench.types, editor.placement.typeId) : undefined;

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setDraggingTypeId(null)}
        >
            <div className={styles.workbench}>
                <aside className={styles.sidebar}>
                    <PagePicker
                        value={workbench.selectedRoute}
                        options={workbench.pageOptions}
                        onChange={workbench.setSelectedRoute}
                        onAddPath={workbench.addCustomPath}
                    />
                    <WidgetLibrary
                        types={workbench.types}
                        counts={counts}
                        onAdd={(typeId) => openCreate({ typeId })}
                        disabled={!ready}
                    />
                </aside>

                <div className={styles.board}>
                    {workbench.loadError && (
                        <div className={styles.error} role="alert">
                            <AlertCircle size={16} aria-hidden />
                            <span className={styles.error_text}>{workbench.loadError}</span>
                            <Button variant="secondary" size="sm" onClick={() => { void workbench.reload(); }}>
                                Try again
                            </Button>
                        </div>
                    )}

                    {ready && workbench.zones?.tracks.map(track => (
                        <section key={track.id} className={styles.track} aria-labelledby={`track-${track.id}`}>
                            <div className={styles.track_header}>
                                <h2 id={`track-${track.id}`} className={styles.track_title}>{track.label}</h2>
                                <span className={styles.track_note}>{trackNote(track.id)}</span>
                            </div>
                            <div className={styles.zones}>
                                {track.zones.map(zone => (
                                    <ZoneBoard
                                        key={zone.id}
                                        zone={zone}
                                        placements={placementsByZone.get(zone.id) ?? []}
                                        types={workbench.types}
                                        busyId={workbench.busyId}
                                        pageScoped={workbench.selectedRoute !== null}
                                        placementInView={workbench.placementInView}
                                        onToggleEnabled={(p, next) => { void workbench.toggleEnabled(p, next); }}
                                        onEdit={openEdit}
                                        onSetWidth={(p, weight) => { void workbench.setWidth(p, weight); }}
                                        onLayoutChange={(zoneId, config) => { void workbench.setZoneLayout(zoneId, config); }}
                                        onMoveWithinList={workbench.moveWithinList}
                                        onMoveOutOfGroup={workbench.moveOutOfGroup}
                                        onAddWidget={(zoneId) => openCreate({ zoneId })}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}

                    {ready && (workbench.zones?.tracks.length ?? 0) === 0 && (
                        <p className={styles.no_zones}>No zones are registered, so there is nowhere to place a widget.</p>
                    )}
                </div>
            </div>

            <DragOverlay dropAnimation={null}>
                {draggingType ? (
                    <div className={styles.drag_chip}>
                        <Plus size={14} aria-hidden />
                        <span>{draggingType.label}</span>
                    </div>
                ) : null}
            </DragOverlay>

            <SlideOver
                open={editor !== null}
                onClose={closeEditor}
                width="lg"
                label={editor?.mode === 'edit' ? `Edit ${editingLabel}` : 'Add a widget'}
                title={(
                    <>
                        <span className={styles.panel_title}>{editingLabel}</span>
                        {editingType && (
                            <span className={styles.panel_subtitle}>
                                {editingType.label} from {providerLabel(editingType.pluginId)}
                            </span>
                        )}
                        {editor?.mode === 'create' && (
                            <span className={styles.panel_subtitle}>Choose the widget, where it shows, and its settings.</span>
                        )}
                    </>
                )}
            >
                {editor && (
                    <PlacementEditor
                        key={editor.mode === 'edit' ? editor.placement.id : 'create'}
                        target={editor}
                        types={workbench.types}
                        zones={workbench.zones}
                        placements={workbench.placements}
                        selectedRoute={workbench.selectedRoute}
                        onCreate={handleCreate}
                        onSave={handleSave}
                        onCancel={closeEditor}
                        onRemove={confirmRemove}
                        onRestore={confirmRestore}
                    />
                )}
            </SlideOver>
        </DndContext>
    );
}
