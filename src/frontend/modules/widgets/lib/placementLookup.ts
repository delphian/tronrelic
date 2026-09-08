/**
 * @fileoverview Small lookups the editor repeats everywhere: resolving a
 * placement's widget type and zone from the admin snapshots, naming a row,
 * and flattening an API error body into one line of text.
 *
 * @module modules/widgets/lib/placementLookup
 */

import type {
    IWidgetPlacement,
    IWidgetTypeSnapshot,
    IWidgetTypeSnapshotRecord,
    IZoneSnapshot,
    IZoneSnapshotRecord
} from '@/types';

/**
 * Widget-type id of the structural layout-group container. Placements of
 * this type hold other widgets through their `parentId`. Mirrors the
 * backend `LAYOUT_GROUP_TYPE_ID`; repeated here because frontend code
 * cannot import backend code.
 */
export const LAYOUT_GROUP_TYPE_ID = 'core:layout-group';

/**
 * Find a widget type's snapshot record by id, so the editor can show the
 * type's label, description, provider, and config schema.
 *
 * @param snapshot - Widget-type snapshot from the admin API, if loaded.
 * @param typeId - The id to find.
 * @returns The record, or undefined when the snapshot lacks it (for
 *   example a plugin that is currently disabled).
 */
export function findWidgetType(
    snapshot: IWidgetTypeSnapshot | null,
    typeId: string
): IWidgetTypeSnapshotRecord | undefined {
    let found: IWidgetTypeSnapshotRecord | undefined;
    if (snapshot && typeId) {
        for (const group of snapshot.groups) {
            const match = group.types.find(type => type.id === typeId);
            if (match) {
                found = match;
                break;
            }
        }
    }
    return found;
}

/**
 * Find a zone's snapshot record by id, so the editor can show the zone's
 * label and description rather than its raw id.
 *
 * @param snapshot - Zone snapshot from the admin API, if loaded.
 * @param zoneId - The id to find.
 * @returns The record, or undefined when no such zone is registered.
 */
export function findZone(snapshot: IZoneSnapshot | null, zoneId: string): IZoneSnapshotRecord | undefined {
    let found: IZoneSnapshotRecord | undefined;
    if (snapshot) {
        for (const track of snapshot.tracks) {
            const match = track.zones.find(zone => zone.id === zoneId);
            if (match) {
                found = match;
                break;
            }
        }
    }
    return found;
}

/**
 * The name a row is shown under: the operator's heading override when set,
 * else the widget type's label, else the raw type id as a last resort.
 *
 * @param placement - The row to name.
 * @param types - Widget-type snapshot used to resolve the type label.
 * @returns The display name.
 */
export function placementLabel(placement: IWidgetPlacement, types: IWidgetTypeSnapshot | null): string {
    return placement.title ?? findWidgetType(types, placement.typeId)?.label ?? placement.typeId;
}

/**
 * Operator-facing name for the component that provides a widget type.
 * Core types read as "Core"; a plugin id is shown as-is because operators
 * know plugins by id from `/system/plugins`.
 *
 * @param pluginId - The declaring component id from the type snapshot.
 * @returns The provider label.
 */
export function providerLabel(pluginId: string): string {
    return pluginId === 'core' ? 'Core' : pluginId;
}

/**
 * Flatten the structured 400 body the placement API returns into a single
 * readable message. Schema validation returns a top-level `error` plus an
 * `errors: [{ path, message }]` array; the per-field lines are appended so
 * an operator sees which setting failed without opening the network tab.
 *
 * @param body - Parsed JSON error body, possibly empty.
 * @param status - HTTP status, used when the body carries no message.
 * @param verb - The attempted action, for the fallback message.
 * @returns One line of text suitable for a toast or an inline error.
 */
export function formatApiError(
    body: { error?: string; errors?: ReadonlyArray<{ path?: string; message?: string }> },
    status: number,
    verb: string
): string {
    const summary = body.error || `${verb} failed (${status})`;
    let message = summary;
    if (Array.isArray(body.errors) && body.errors.length > 0) {
        const fields = body.errors
            .map(entry => `${entry.path?.length ? entry.path : '/'}: ${entry.message ?? 'invalid'}`)
            .join('; ');
        message = `${summary}. ${fields}`;
    }
    return message;
}
