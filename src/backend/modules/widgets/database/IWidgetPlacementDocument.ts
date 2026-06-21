/**
 * @fileoverview Mongo document interface for widget placements.
 *
 * The `module_widgets_placements` collection stores every placement
 * record — both plugin-source (created via the legacy widget-service
 * compatibility shim on plugin enable) and operator-source (created
 * via the admin API in a future PR). The document interface mirrors
 * `IWidgetPlacement` from the types package but with native Mongo
 * types (`ObjectId`, `Date`).
 *
 * @see {@link ../../../../docs/system/system-database.md} for
 *   database access patterns and the manual `module_*_*` collection
 *   prefixing convention.
 * @module backend/modules/widgets/database/IWidgetPlacementDocument
 */

import type { ObjectId } from 'mongodb';
import type { PlacementSource } from '@/types';

/**
 * Widget placement document as stored in MongoDB.
 *
 * Placements survive plugin disable/re-enable cycles because plugin
 * lifecycle calls `softDisable` (flip `enabled: false`) rather than
 * deleting rows. Operator customisations to `order`, `routes`,
 * `title`, `titleUrl`, or `instanceConfig` therefore persist across
 * plugin lifecycle events. Hard delete is reserved for the admin API.
 */
export interface IWidgetPlacementDocument {
    _id: ObjectId;
    /** Widget-type id this placement renders. */
    typeId: string;
    /** Zone id this placement targets. */
    zoneId: string;
    /**
     * Parent container placement id when this row nests inside a
     * `core:layout-group`. Stored as an `ObjectId` so it references
     * another row's `_id` natively; `toPublic` exposes it as the hex
     * string `parentId`. Absent for directly-zoned placements. Nesting is
     * capped at one level — a container never carries a `parentId`.
     */
    parentId?: ObjectId;
    /** Route filter — empty array matches every route. */
    routes: string[];
    /** Sort order within the zone (lower renders first). */
    order: number;
    /** Optional heading rendered above the widget. */
    title?: string;
    /** Optional root-relative URL linking the heading. Operator-only. */
    titleUrl?: string;
    /** Per-instance configuration. */
    instanceConfig?: Record<string, unknown>;
    /** Whether the placement currently renders. */
    enabled: boolean;
    /** Source discriminator — plugin-seeded or operator-created. */
    source: PlacementSource;
    /** Plugin id that owns the placement when `source === 'plugin'`. */
    pluginId?: string;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Logical collection name used by the placement service. The
 * `IDatabaseService` returns the physical collection
 * `module_widgets_placements` via the module-prefix convention; the
 * service itself supplies the prefixed name when calling
 * `database.getCollection(...)`.
 */
export const WIDGET_PLACEMENT_COLLECTION = 'module_widgets_placements';
