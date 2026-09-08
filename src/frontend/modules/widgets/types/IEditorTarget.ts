/**
 * @fileoverview What the placement editor panel is currently editing.
 *
 * The editor panel is a slide-over bound to one target at a time: either a
 * new placement being composed (seeded with whatever the operator's gesture
 * already decided, such as the zone they dropped a widget on) or an existing
 * row. Keeping the two shapes in one discriminated union lets the workbench
 * hold a single `editor` state and the panel branch on `mode`.
 *
 * @module modules/widgets/types/IEditorTarget
 */

import type { IWidgetPlacement } from '@/types';

/**
 * Where a newly created placement should land in its destination list.
 * `beforeId` names the row the new one goes in front of; `null` appends.
 */
export interface IInsertPosition {
    /** Zone the row is created in. */
    zoneId: string;
    /** Layout-group container to nest inside, or null for the zone top level. */
    parentId: string | null;
    /** Row to insert before, or null to append at the end of the list. */
    beforeId: string | null;
}

/**
 * A new placement being composed. Every field is optional because each
 * gesture that opens the editor knows a different subset: the library's
 * add button knows the type, a drop on a zone knows type and position, the
 * zone's own add button knows only the zone.
 */
export interface ICreateEditorTarget {
    mode: 'create';
    /** Widget type chosen before the panel opened, if any. */
    typeId?: string;
    /** Zone chosen before the panel opened, if any. */
    zoneId?: string;
    /** Container chosen before the panel opened, if any. */
    parentId?: string;
    /** Route filter to start from, usually the page the editor is scoped to. */
    routes: string[];
    /** Where to insert the row once saved; absent means append to the zone. */
    position?: IInsertPosition;
}

/**
 * An existing placement being edited.
 */
export interface IEditEditorTarget {
    mode: 'edit';
    /** The row as last loaded; the panel seeds its form from it. */
    placement: IWidgetPlacement;
}

/** The editor panel's binding, or null when the panel is closed. */
export type EditorTarget = ICreateEditorTarget | IEditEditorTarget;
