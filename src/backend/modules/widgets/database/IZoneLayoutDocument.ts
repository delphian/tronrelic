/**
 * @fileoverview Mongo document interface for per-zone layout overrides.
 *
 * Zones are code-declared and rebuilt in memory every boot, so an
 * operator's choice of how a zone arranges its widgets has nowhere to
 * live on the descriptor. This collection is that home: one row per zone
 * id holding the flexbox config the `WidgetZone` renderer applies. Absent
 * a row, the zone falls back to a default derived from its descriptor's
 * coarse `layout` hint, so this collection only ever holds genuine
 * operator overrides.
 *
 * @see {@link ../../../../docs/system/system-database.md} for the manual
 *   `module_*_*` collection-prefix convention.
 * @module backend/modules/widgets/database/IZoneLayoutDocument
 */

import type { ObjectId } from 'mongodb';
import type {
    IZoneLayoutConfig,
    ZoneFlexDirection,
    ZoneJustifyContent,
    ZoneAlignItems,
    ZoneFlexWrap,
    ZoneGapSize,
    ZoneLayoutPreset
} from '@/types';

/**
 * Zone layout override as stored in MongoDB. The flex fields mirror
 * `IZoneLayoutConfig`; `zoneId` is the stable identity (unique) so a
 * zone never carries two override rows.
 */
export interface IZoneLayoutDocument {
    _id: ObjectId;
    /** Zone id this override applies to. Unique. */
    zoneId: string;
    /** Preset the operator last selected, or `'custom'` when hand-tuned. */
    preset?: ZoneLayoutPreset;
    /** Main-axis orientation. */
    flexDirection: ZoneFlexDirection;
    /** Main-axis distribution. */
    justifyContent: ZoneJustifyContent;
    /** Cross-axis alignment. */
    alignItems: ZoneAlignItems;
    /** Whether items wrap onto multiple lines. */
    flexWrap: ZoneFlexWrap;
    /** Inter-item gap as a token size. */
    gap: ZoneGapSize;
    /**
     * Container width below which the zone collapses to a stacked column.
     * Absent or `'never'` means the zone never collapses — the behaviour
     * for every zone configured before this field existed. Typed off
     * `IZoneLayoutConfig` so the document and the public config never
     * drift.
     */
    collapseBelow?: IZoneLayoutConfig['collapseBelow'];
    /** Operator-authored CSS declarations applied to the zone container. */
    customCss?: string;
    updatedAt: Date;
}

/**
 * Logical collection name. `IDatabaseService` maps it to the physical
 * `module_widgets_zone_layouts` via the module-prefix convention; the
 * service supplies this prefixed name to `getCollection(...)`.
 */
export const ZONE_LAYOUT_COLLECTION = 'module_widgets_zone_layouts';
