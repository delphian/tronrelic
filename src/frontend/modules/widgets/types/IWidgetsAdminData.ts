/**
 * @fileoverview The server-fetched bundle that seeds the placement editor.
 *
 * `/system/widgets` follows the SSR + Live Updates pattern: the server entry
 * fetches everything the editor shows and hands it to the client shell as
 * one prop, so the first paint carries real zones and placements rather than
 * a loading message. The client then keeps the same shape current through
 * WebSocket-triggered refetches.
 *
 * @module modules/widgets/types/IWidgetsAdminData
 */

import type { IWidgetPlacement, IWidgetTypeSnapshot, IZoneSnapshot } from '@/types';
import type { IPageOption } from './IPageOption';

/**
 * Everything the placement editor needs on first render.
 */
export interface IWidgetsAdminData {
    /** Registered zones grouped by host track, each with its effective layout. */
    zones: IZoneSnapshot | null;
    /** Registered widget types grouped by declaring plugin. */
    types: IWidgetTypeSnapshot | null;
    /** Every placement row, top-level and nested alike. */
    placements: IWidgetPlacement[];
    /** Real site pages taken from the navigation menu, for the page picker. */
    pages: IPageOption[];
    /**
     * Set when any of the admin fetches failed during server render. The
     * editor renders its frame with an error notice and a retry action
     * instead of a spinner, so the failure is visible rather than silent.
     */
    loadError: string | null;
}
