/**
 * @fileoverview State and mutations behind the placement editor.
 *
 * The workbench components are presentational; everything that talks to
 * the admin API, keeps the local snapshot current, or decides where a row
 * lands after a drag lives here. Keeping it in one hook means drag-drop,
 * the move buttons, the library drop, and the editor panel all reorder
 * against the same lists with the same renumbering, which is what stopped
 * the earlier page's "row jumped somewhere else" reports.
 *
 * State is seeded from the server-fetched bundle (SSR + Live Updates) and
 * kept current by refetching on the `widgets:placements-update` WebSocket
 * signal, so two admin tabs converge without a reload.
 *
 * @module modules/widgets/hooks/usePlacementsWorkbench
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DragEndEvent } from '@dnd-kit/core';
import type {
    IPlacementInput,
    IPlacementPatch,
    IWidgetPlacement,
    IWidgetTypeSnapshot,
    IZoneLayoutConfig,
    IZoneSnapshot
} from '@/types';
import { useToast } from '../../../components/ui/ToastProvider';
import { getSocket } from '../../../lib/socketClient';
import {
    createPlacement as apiCreatePlacement,
    deletePlacement as apiDeletePlacement,
    fetchAdminSnapshot,
    patchPlacement as apiPatchPlacement,
    restorePlacementDefaults as apiRestoreDefaults,
    saveZoneLayout as apiSaveZoneLayout
} from '../api/client';
import { LAYOUT_GROUP_TYPE_ID } from '../lib/placementLookup';
import { buildPageOptions } from '../lib/pageOptions';
import { normaliseRouteInput, placementMatchesRoute } from '../lib/routeMatcher';
import type { IInsertPosition } from '../types/IEditorTarget';
import type { IPageOption } from '../types/IPageOption';
import type { IWidgetsAdminData } from '../types/IWidgetsAdminData';

/**
 * Drop data every droppable and sortable in the workbench attaches, so
 * `resolveDrop` can read one shape whatever was hit.
 */
export interface IDropData {
    /** `gap` for a top-level insertion rail; absent for rows and regions. */
    kind?: 'gap';
    /** Zone the target belongs to. */
    zoneId?: string;
    /** Layout-group id when the target is a group's children region. */
    containerId?: string;
    /** Parent id when the target is a nested child row. */
    parentId?: string;
    /** For a gap rail: the row it precedes, or null to append. */
    beforeId?: string | null;
}

/**
 * One row's mutation in a reorder: the patch to send for that id.
 */
interface IReorderOp {
    id: string;
    patch: IPlacementPatch;
}

/**
 * A placement whose fields can be assigned. The shared record is read-only
 * because consumers must not mutate server data in place; the optimistic
 * update below builds a fresh copy and needs to write to it before it
 * becomes the new read-only row.
 */
type MutablePlacement = { -readonly [K in keyof IWidgetPlacement]: IWidgetPlacement[K] };

/**
 * Sort a list of placements by their render order.
 *
 * @param list - Rows to sort; not mutated.
 * @returns A new array in ascending order.
 */
function byOrder(list: ReadonlyArray<IWidgetPlacement>): IWidgetPlacement[] {
    return [...list].sort((a, b) => a.order - b.order);
}

/**
 * Everything the workbench UI reads and calls.
 */
export interface IPlacementsWorkbench {
    zones: IZoneSnapshot | null;
    types: IWidgetTypeSnapshot | null;
    placements: IWidgetPlacement[];
    /** Set when the snapshot could not be loaded; cleared by a successful reload. */
    loadError: string | null;
    /** Re-fetch every snapshot from the server. */
    reload: () => Promise<void>;
    /** Id of the row with a write in flight, so its controls go inert. */
    busyId: string | null;
    /** The page the editor is scoped to, or null for site-wide widgets only. */
    selectedRoute: string | null;
    setSelectedRoute: (route: string | null) => void;
    /** Every option the page picker offers. */
    pageOptions: IPageOption[];
    /** Validate a typed path, add it to the picker, and select it. */
    addCustomPath: (raw: string) => boolean;
    /** Whether a row belongs to the current page view. */
    placementInView: (placement: IWidgetPlacement) => boolean;
    /** The ordered sibling list a row lives in. */
    siblingList: (containerId: string | null, zoneId: string) => IWidgetPlacement[];
    toggleEnabled: (placement: IWidgetPlacement, next: boolean) => Promise<void>;
    setWidth: (placement: IWidgetPlacement, weight: number | null) => Promise<void>;
    setZoneLayout: (zoneId: string, config: IZoneLayoutConfig) => Promise<void>;
    moveWithinList: (placement: IWidgetPlacement, direction: 'up' | 'down') => void;
    moveOutOfGroup: (placement: IWidgetPlacement) => void;
    /** Translate a row drag-end into a persisted move. */
    dropPlacement: (event: DragEndEvent) => Promise<void>;
    /** Translate a drop target into where a new row should be inserted. */
    resolveInsertPosition: (over: DragEndEvent['over']) => IInsertPosition | null;
    createPlacementAt: (input: IPlacementInput, position: IInsertPosition | null) => Promise<IWidgetPlacement>;
    savePlacement: (id: string, patch: IPlacementPatch) => Promise<IWidgetPlacement>;
    removePlacement: (id: string) => Promise<void>;
    restorePlacement: (id: string) => Promise<void>;
}

/**
 * Own the placement editor's data and every mutation against it.
 *
 * @param initial - The server-fetched bundle that seeds local state.
 * @returns The workbench state and actions.
 */
export function usePlacementsWorkbench(initial: IWidgetsAdminData): IPlacementsWorkbench {
    const { push: pushToast } = useToast();

    const [zones, setZones] = useState<IZoneSnapshot | null>(initial.zones);
    const [types, setTypes] = useState<IWidgetTypeSnapshot | null>(initial.types);
    const [placements, setPlacements] = useState<IWidgetPlacement[]>(initial.placements);
    const [loadError, setLoadError] = useState<string | null>(initial.loadError);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [selectedRoute, setSelectedRoute] = useState<string | null>(null);
    const [customPaths, setCustomPaths] = useState<string[]>([]);

    /**
     * Show a failure toast. Errors always toast because the operator may be
     * looking at a different zone than the one that failed.
     *
     * @param title - What was attempted.
     * @param error - The thrown value.
     */
    const notifyError = useCallback((title: string, error: unknown) => {
        pushToast({
            tone: 'danger',
            title,
            description: error instanceof Error ? error.message : String(error)
        });
    }, [pushToast]);

    /**
     * Re-fetch all three snapshots. Never flashes a loading state: the
     * current rows stay on screen until the new ones replace them.
     */
    const reload = useCallback(async (): Promise<void> => {
        try {
            const snapshot = await fetchAdminSnapshot();
            setZones(snapshot.zones);
            setTypes(snapshot.types);
            setPlacements(snapshot.placements);
            setLoadError(null);
        } catch (error) {
            setLoadError(error instanceof Error ? error.message : String(error));
        }
    }, []);

    /* Live updates: any placement or zone-layout change in another tab or
       by another admin triggers a refetch. */
    useEffect(() => {
        const socket = getSocket();
        const handler = () => { void reload(); };
        socket.on('widgets:placements-update', handler);
        return () => {
            socket.off('widgets:placements-update', handler);
        };
    }, [reload]);

    const pageOptions = useMemo(
        () => buildPageOptions(initial.pages, placements, customPaths),
        [initial.pages, placements, customPaths]
    );

    /**
     * Accept a typed path, register it as a picker option, and scope the
     * editor to it. An invalid path toasts rather than silently failing.
     *
     * @param raw - Text from the path input.
     * @returns True when the path was accepted.
     */
    const addCustomPath = useCallback((raw: string): boolean => {
        const path = normaliseRouteInput(raw);
        if (!path) {
            pushToast({
                tone: 'danger',
                title: 'Not a valid path',
                description: 'Enter a path starting with “/”, for example /markets.'
            });
        } else {
            setCustomPaths(prev => (prev.includes(path) ? prev : [...prev, path]));
            setSelectedRoute(path);
        }
        return path !== null;
    }, [pushToast]);

    /**
     * Whether a row belongs to the current page view. Nested children carry
     * no route filter of their own and follow their container, so only
     * top-level rows are tested.
     *
     * @param placement - The row to test.
     * @returns True when the row shows on the selected page (or is
     *   site-wide when no page is selected).
     */
    const placementInView = useCallback((placement: IWidgetPlacement): boolean => {
        let visible = true;
        if (!placement.parentId) {
            visible = selectedRoute === null
                ? placement.routes.length === 0
                : placementMatchesRoute(placement.routes, selectedRoute);
        }
        return visible;
    }, [selectedRoute]);

    /**
     * The ordered sibling list a row lives in, drawn from an explicit pool
     * so a caller that has just created a row can include it before React
     * state catches up.
     *
     * @param pool - The placements to search.
     * @param containerId - Layout-group id for a child list, or null for
     *   the zone's top-level list.
     * @param zoneId - Zone whose top-level rows to gather.
     * @returns Matching rows sorted by order.
     */
    const siblingListFrom = useCallback(
        (pool: ReadonlyArray<IWidgetPlacement>, containerId: string | null, zoneId: string): IWidgetPlacement[] =>
            byOrder(containerId
                ? pool.filter(p => p.parentId === containerId)
                : pool.filter(p => !p.parentId && p.zoneId === zoneId && placementInView(p))),
        [placementInView]
    );

    const siblingList = useCallback(
        (containerId: string | null, zoneId: string) => siblingListFrom(placements, containerId, zoneId),
        [placements, siblingListFrom]
    );

    /**
     * Apply a set of reorder patches locally, then persist them. Local
     * state changes first so the row snaps into place; a failed write
     * falls back to a refetch of the server truth.
     *
     * @param ops - Per-row patches to apply and send.
     * @param destZone - Zone a reparented row lands in, for the local copy.
     */
    const commitOps = useCallback(async (ops: IReorderOp[], destZone: string): Promise<void> => {
        if (ops.length === 0) return;
        setPlacements(prev => {
            const byId = new Map(prev.map(p => [p.id, p]));
            for (const op of ops) {
                const existing = byId.get(op.id);
                if (!existing) continue;
                const next: MutablePlacement = { ...existing };
                if (op.patch.order !== undefined) next.order = op.patch.order;
                if (op.patch.zoneId !== undefined) next.zoneId = op.patch.zoneId;
                if (op.patch.parentId !== undefined) {
                    if (op.patch.parentId === null) {
                        next.parentId = undefined;
                    } else {
                        next.parentId = op.patch.parentId;
                        next.zoneId = destZone;
                        next.routes = [];
                    }
                }
                byId.set(op.id, next);
            }
            return Array.from(byId.values());
        });
        try {
            await Promise.all(ops.map(op => apiPatchPlacement(op.id, op.patch)));
        } catch (error) {
            notifyError('Could not move the widget', error);
            void reload();
        }
    }, [notifyError, reload]);

    /**
     * Move a row into a destination list and persist the result: the
     * shared engine behind drag-drop, the gap rails, the move buttons, and
     * the post-create normalise. Inserts the row at the index the caller
     * resolves, then renumbers each affected list sequentially (10, 20,
     * 30…). The moved row also gets a `parentId` patch when its container
     * changed and a `zoneId` patch on a plain zone move.
     *
     * @param pool - Placements to compute lists from.
     * @param moved - The row being relocated.
     * @param requestedContainer - Destination layout-group id, or null for
     *   the zone top level. Forced to null for a layout group, which never
     *   nests; a no-op when it names the moved row itself.
     * @param destZone - Destination zone id.
     * @param resolveInsertIdx - Given the destination list with the moved
     *   row excluded, returns the index to insert at.
     */
    const applyMove = useCallback(async (
        pool: ReadonlyArray<IWidgetPlacement>,
        moved: IWidgetPlacement,
        requestedContainer: string | null,
        destZone: string,
        resolveInsertIdx: (destListPrev: IWidgetPlacement[]) => number
    ): Promise<void> => {
        const destContainerId = moved.typeId === LAYOUT_GROUP_TYPE_ID ? null : requestedContainer;
        if (destContainerId === moved.id) return;

        const sourceContainerId = moved.parentId ?? null;
        const srcKey = sourceContainerId ? `c:${sourceContainerId}` : `z:${moved.zoneId}`;
        const dstKey = destContainerId ? `c:${destContainerId}` : `z:${destZone}`;
        const sameList = srcKey === dstKey;

        const sourceList = siblingListFrom(pool, sourceContainerId, moved.zoneId);
        const sourceWithoutActive = sourceList.filter(p => p.id !== moved.id);
        const destListPrev = sameList ? sourceWithoutActive : siblingListFrom(pool, destContainerId, destZone);
        const insertIdx = Math.max(0, Math.min(resolveInsertIdx(destListPrev), destListPrev.length));

        const movedNext: IWidgetPlacement = { ...moved, parentId: destContainerId ?? undefined, zoneId: destZone };
        const newDest = [...destListPrev.slice(0, insertIdx), movedNext, ...destListPrev.slice(insertIdx)];
        const newSource = sameList ? newDest : sourceWithoutActive;

        const parentChanged = (moved.parentId ?? null) !== destContainerId;
        const zoneChanged = moved.zoneId !== destZone;

        const ops: IReorderOp[] = [];
        newDest.forEach((p, idx) => {
            const nextOrder = (idx + 1) * 10;
            const patch: IPlacementPatch = {};
            if (p.order !== nextOrder) patch.order = nextOrder;
            if (p.id === moved.id) {
                if (parentChanged) patch.parentId = destContainerId;
                if (destContainerId === null && zoneChanged) patch.zoneId = destZone;
            }
            if (Object.keys(patch).length > 0) ops.push({ id: p.id, patch });
        });
        if (!sameList) {
            newSource.forEach((p, idx) => {
                const nextOrder = (idx + 1) * 10;
                if (p.order !== nextOrder) ops.push({ id: p.id, patch: { order: nextOrder } });
            });
        }
        await commitOps(ops, destZone);
    }, [siblingListFrom, commitOps]);

    /**
     * Read the drop target's data into an insert position. A gap rail
     * inserts at the zone top level before its anchor; a group's children
     * region or a nested row nests into that group; anything else lands in
     * the zone directly. A row target inserts before that row.
     *
     * @param over - The dnd-kit `over` node from a drag-end event.
     * @returns Where to insert, or null when nothing was hit.
     */
    const resolveInsertPosition = useCallback((over: DragEndEvent['over']): IInsertPosition | null => {
        let position: IInsertPosition | null = null;
        if (over) {
            const data = (over.data.current ?? {}) as IDropData;
            const overId = String(over.id);
            if (data.kind === 'gap' && data.zoneId) {
                position = { zoneId: data.zoneId, parentId: null, beforeId: data.beforeId ?? null };
            } else if (typeof data.containerId === 'string' && data.zoneId) {
                position = { zoneId: data.zoneId, parentId: data.containerId, beforeId: null };
            } else if (typeof data.parentId === 'string' && data.zoneId) {
                position = { zoneId: data.zoneId, parentId: data.parentId, beforeId: overId };
            } else {
                const zoneId = data.zoneId ?? overId;
                const isZoneArea = overId === zoneId;
                position = { zoneId, parentId: null, beforeId: isZoneArea ? null : overId };
            }
        }
        return position;
    }, []);

    /**
     * Translate a row drag-end into an `applyMove`.
     *
     * @param event - The dnd-kit drag-end event.
     */
    const dropPlacement = useCallback(async (event: DragEndEvent): Promise<void> => {
        const { active, over } = event;
        const moved = placements.find(p => p.id === String(active.id));
        const position = resolveInsertPosition(over);
        if (!moved || !position) return;

        // Dropping a row on its own leading rail, or on its own slot, changes nothing.
        if (position.beforeId === moved.id) return;

        const sourceContainerId = moved.parentId ?? null;
        const sameList = (sourceContainerId ? `c:${sourceContainerId}` : `z:${moved.zoneId}`)
            === (position.parentId ? `c:${position.parentId}` : `z:${position.zoneId}`);
        if (over && active.id === over.id && sameList) return;

        await applyMove(placements, moved, position.parentId, position.zoneId, destListPrev => {
            let idx = destListPrev.length;
            if (position.beforeId !== null) {
                const found = destListPrev.findIndex(p => p.id === position.beforeId);
                if (found >= 0) idx = found;
            }
            return idx;
        });
    }, [placements, resolveInsertPosition, applyMove]);

    /**
     * Nudge a row one step within its current list. Backs the up and down
     * buttons, the keyboard-friendly alternative to dragging.
     *
     * @param moved - The row to nudge.
     * @param direction - Which neighbour to swap with; boundary steps are ignored.
     */
    const moveWithinList = useCallback((moved: IWidgetPlacement, direction: 'up' | 'down'): void => {
        const containerId = moved.parentId ?? null;
        const list = siblingListFrom(placements, containerId, moved.zoneId);
        const currentIdx = list.findIndex(p => p.id === moved.id);
        const targetIdx = direction === 'up' ? currentIdx - 1 : currentIdx + 1;
        if (currentIdx >= 0 && targetIdx >= 0 && targetIdx < list.length) {
            void applyMove(placements, moved, containerId, moved.zoneId, () => targetIdx);
        }
    }, [placements, siblingListFrom, applyMove]);

    /**
     * Promote a nested child out of its group to the zone top level,
     * directly after its former container.
     *
     * @param moved - The nested child; a no-op when already top-level.
     */
    const moveOutOfGroup = useCallback((moved: IWidgetPlacement): void => {
        const containerId = moved.parentId ?? null;
        if (containerId) {
            const topList = siblingListFrom(placements, null, moved.zoneId);
            const containerIdx = topList.findIndex(p => p.id === containerId);
            const insertIdx = containerIdx < 0 ? topList.length : containerIdx + 1;
            void applyMove(placements, moved, null, moved.zoneId, () => insertIdx);
        }
    }, [placements, siblingListFrom, applyMove]);

    /**
     * Patch one row with an optimistic local update. Used by the inline
     * controls (enabled switch, width) that need no confirmation and no
     * success toast: the row itself shows the result.
     *
     * @param placement - The row to change.
     * @param patch - The patch to send.
     * @param optimistic - The local change to show immediately.
     * @param failureTitle - Toast title if the write fails.
     */
    const patchInline = useCallback(async (
        placement: IWidgetPlacement,
        patch: IPlacementPatch,
        optimistic: Partial<IWidgetPlacement>,
        failureTitle: string
    ): Promise<void> => {
        setBusyId(placement.id);
        setPlacements(prev => prev.map(p => (p.id === placement.id ? { ...p, ...optimistic } : p)));
        try {
            const saved = await apiPatchPlacement(placement.id, patch);
            setPlacements(prev => prev.map(p => (p.id === saved.id ? saved : p)));
        } catch (error) {
            notifyError(failureTitle, error);
            void reload();
        } finally {
            setBusyId(null);
        }
    }, [notifyError, reload]);

    const toggleEnabled = useCallback(
        (placement: IWidgetPlacement, next: boolean) =>
            patchInline(placement, { enabled: next }, { enabled: next }, next ? 'Could not turn the widget on' : 'Could not turn the widget off'),
        [patchInline]
    );

    const setWidth = useCallback(
        (placement: IWidgetPlacement, weight: number | null) =>
            patchInline(placement, { layoutWeight: weight }, { layoutWeight: weight ?? undefined }, 'Could not change the width'),
        [patchInline]
    );

    /**
     * Persist a zone's layout with an optimistic local update so the strip
     * and the panel reflect the change at once.
     *
     * @param zoneId - The zone to change.
     * @param config - The new layout.
     */
    const setZoneLayout = useCallback(async (zoneId: string, config: IZoneLayoutConfig): Promise<void> => {
        setZones(prev => (prev
            ? {
                tracks: prev.tracks.map(track => ({
                    ...track,
                    zones: track.zones.map(zone => (zone.id === zoneId ? { ...zone, layoutConfig: config } : zone))
                }))
            }
            : prev));
        try {
            await apiSaveZoneLayout(zoneId, config);
        } catch (error) {
            notifyError('Could not save the zone layout', error);
            void reload();
        }
    }, [notifyError, reload]);

    /**
     * Create a row and, when a position was requested, normalise the
     * destination list so the new row sits exactly where the operator
     * dropped it. The row is created with a provisional order (just below
     * its anchor, or after the last row), then the list is renumbered.
     *
     * @param input - The row to create.
     * @param position - Where it should land, or null to append to its zone.
     * @returns The created row.
     */
    const createPlacementAt = useCallback(async (
        input: IPlacementInput,
        position: IInsertPosition | null
    ): Promise<IWidgetPlacement> => {
        const containerId = position?.parentId ?? input.parentId ?? null;
        const list = siblingListFrom(placements, containerId, input.zoneId);
        const anchor = position?.beforeId ? list.find(p => p.id === position.beforeId) : undefined;
        const last = list[list.length - 1];
        const provisionalOrder = anchor ? Math.max(0, anchor.order - 1) : (last ? last.order + 10 : 10);

        const created = await apiCreatePlacement({ ...input, order: provisionalOrder });
        const pool = [...placements.filter(p => p.id !== created.id), created];
        setPlacements(pool);

        if (anchor) {
            await applyMove(pool, created, containerId, created.zoneId, destListPrev => {
                const found = destListPrev.findIndex(p => p.id === anchor.id);
                return found < 0 ? destListPrev.length : found;
            });
        }
        pushToast({ tone: 'success', title: 'Widget added' });
        return created;
    }, [placements, siblingListFrom, applyMove, pushToast]);

    /**
     * Save the editor panel's changes to an existing row.
     *
     * @param id - The row to change.
     * @param patch - The patch to send.
     * @returns The saved row.
     */
    const savePlacement = useCallback(async (id: string, patch: IPlacementPatch): Promise<IWidgetPlacement> => {
        const saved = await apiPatchPlacement(id, patch);
        setPlacements(prev => prev.map(p => (p.id === saved.id ? saved : p)));
        pushToast({ tone: 'success', title: 'Changes saved' });
        return saved;
    }, [pushToast]);

    /**
     * Delete an operator row. A deleted layout group's children are
     * detached to the zone by the server, so a refetch follows to pick
     * up their new state.
     *
     * @param id - The row to remove.
     */
    const removePlacement = useCallback(async (id: string): Promise<void> => {
        await apiDeletePlacement(id);
        setPlacements(prev => prev.filter(p => p.id !== id));
        pushToast({ tone: 'success', title: 'Widget removed' });
        void reload();
    }, [pushToast, reload]);

    /**
     * Reset a plugin row to what its plugin registered.
     *
     * @param id - The plugin-source row to reset.
     */
    const restorePlacement = useCallback(async (id: string): Promise<void> => {
        const restored = await apiRestoreDefaults(id);
        setPlacements(prev => prev.map(p => (p.id === restored.id ? restored : p)));
        pushToast({ tone: 'success', title: 'Plugin defaults restored' });
    }, [pushToast]);

    return {
        zones,
        types,
        placements,
        loadError,
        reload,
        busyId,
        selectedRoute,
        setSelectedRoute,
        pageOptions,
        addCustomPath,
        placementInView,
        siblingList,
        toggleEnabled,
        setWidth,
        setZoneLayout,
        moveWithinList,
        moveOutOfGroup,
        dropPlacement,
        resolveInsertPosition,
        createPlacementAt,
        savePlacement,
        removePlacement,
        restorePlacement
    };
}
