/**
 * @fileoverview Browser-side client for the widgets admin API.
 *
 * Every call is a same-origin fetch: the Better Auth session cookie rides
 * along and `requireAdmin` on the backend consults it. Each function
 * throws an `Error` whose message is already operator-readable, so callers
 * can show it in a toast or an inline notice without reformatting.
 *
 * @module modules/widgets/api/client
 */

import type {
    IPlacementInput,
    IPlacementPatch,
    IWidgetPlacement,
    IWidgetTypeSnapshot,
    IZoneLayoutConfig,
    IZoneSnapshot
} from '@/types';
import { formatApiError } from '../lib/placementLookup';

/** Base path of the placement CRUD endpoints. */
const PLACEMENTS_BASE = '/api/admin/system/widgets/placements';

/**
 * Parse an error response into a thrown `Error`. The body may be JSON with
 * a structured validation report or may be empty; both yield one line.
 *
 * @param res - The failed response.
 * @param verb - The attempted action, for the fallback message.
 * @returns An error carrying the readable message.
 */
async function toError(res: Response, verb: string): Promise<Error> {
    const body = await res.json().catch(() => ({}));
    return new Error(formatApiError(body, res.status, verb));
}

/**
 * Re-fetch the three snapshots the editor renders from. Used after a
 * WebSocket change signal and as the retry path when the server render
 * could not load them.
 *
 * @returns Zones, widget types, and every placement.
 */
export async function fetchAdminSnapshot(): Promise<{
    zones: IZoneSnapshot;
    types: IWidgetTypeSnapshot;
    placements: IWidgetPlacement[];
}> {
    const [zonesRes, typesRes, placementsRes] = await Promise.all([
        fetch('/api/admin/system/zones'),
        fetch('/api/admin/system/widget-types'),
        fetch(PLACEMENTS_BASE)
    ]);
    if (!zonesRes.ok) throw new Error(`Could not load zones (${zonesRes.status})`);
    if (!typesRes.ok) throw new Error(`Could not load widget types (${typesRes.status})`);
    if (!placementsRes.ok) throw new Error(`Could not load placements (${placementsRes.status})`);
    const [zones, types, placementsBody] = await Promise.all([
        zonesRes.json() as Promise<IZoneSnapshot>,
        typesRes.json() as Promise<IWidgetTypeSnapshot>,
        placementsRes.json() as Promise<{ placements?: IWidgetPlacement[] }>
    ]);
    return { zones, types, placements: placementsBody.placements ?? [] };
}

/**
 * Create an operator-source placement.
 *
 * @param input - The new row.
 * @returns The created row as the server stored it, including its id.
 */
export async function createPlacement(input: IPlacementInput): Promise<IWidgetPlacement> {
    const res = await fetch(PLACEMENTS_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
    });
    if (!res.ok) throw await toError(res, 'Add widget');
    const body = await res.json() as { placement: IWidgetPlacement };
    return body.placement;
}

/**
 * Patch one placement. Plugin-source rows accept the same patch as operator
 * rows; the server enforces the three-state `null` conventions.
 *
 * @param id - The placement to change.
 * @param patch - Fields to set, clear, or leave alone.
 * @returns The updated row.
 */
export async function patchPlacement(id: string, patch: IPlacementPatch): Promise<IWidgetPlacement> {
    const res = await fetch(`${PLACEMENTS_BASE}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
    });
    if (!res.ok) throw await toError(res, 'Save');
    const body = await res.json() as { placement: IWidgetPlacement };
    return body.placement;
}

/**
 * Delete an operator-source placement. The server refuses plugin rows with
 * 400; the editor never offers delete on those.
 *
 * @param id - The placement to remove.
 */
export async function deletePlacement(id: string): Promise<void> {
    const res = await fetch(`${PLACEMENTS_BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw await toError(res, 'Remove');
}

/**
 * Restore a plugin-source placement to the values its plugin registered.
 *
 * @param id - The plugin-source placement to reset.
 * @returns The restored row.
 */
export async function restorePlacementDefaults(id: string): Promise<IWidgetPlacement> {
    const res = await fetch(`${PLACEMENTS_BASE}/${encodeURIComponent(id)}/restore-defaults`, { method: 'POST' });
    if (!res.ok) throw await toError(res, 'Restore');
    const body = await res.json() as { placement: IWidgetPlacement };
    return body.placement;
}

/**
 * Persist a zone's flexbox layout override.
 *
 * @param zoneId - The zone to change.
 * @param config - The complete layout to store.
 */
export async function saveZoneLayout(zoneId: string, config: IZoneLayoutConfig): Promise<void> {
    const res = await fetch(`/api/admin/system/zones/${encodeURIComponent(zoneId)}/layout`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
    });
    if (!res.ok) throw await toError(res, 'Save layout');
}
