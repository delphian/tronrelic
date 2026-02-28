/**
 * Menu Redux slice for live WebSocket-driven menu state.
 *
 * Stores menu tree data per namespace, updated in real-time via WebSocket
 * events broadcast by the backend MenuService. Components read from this
 * slice to overlay live state on top of SSR-provided menu items, following
 * the SSR + Live Updates pattern.
 */

import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { MenuUpdatePayload } from '@/shared';

/**
 * Serializable menu item matching the IMenuNodeWithChildren shape
 * after JSON serialization over WebSocket.
 */
export interface MenuItemLive {
    _id: string;
    label: string;
    url?: string;
    icon?: string;
    order: number;
    parent: string | null;
    enabled: boolean;
    namespace?: string;
    children?: MenuItemLive[];
}

/**
 * Per-namespace menu tree state.
 */
interface MenuNamespaceState {
    roots: MenuItemLive[];
    lastUpdated: string;
}

/**
 * Root state shape for the menu slice.
 */
export interface MenuState {
    /** Menu trees keyed by namespace (e.g., 'main', 'system'). */
    namespaces: Record<string, MenuNamespaceState>;
}

const initialState: MenuState = {
    namespaces: {}
};

const menuSlice = createSlice({
    name: 'menu',
    initialState,
    reducers: {
        /**
         * Update menu tree for a namespace from a WebSocket menu:update event.
         *
         * Extracts the namespace from the node in the payload and stores
         * the full tree roots for that namespace, enabling components to
         * read live menu state.
         */
        menuTreeUpdated(state, action: PayloadAction<MenuUpdatePayload['payload']>) {
            const { node, tree, timestamp } = action.payload;
            const namespace = (node as Record<string, unknown>).namespace as string || 'main';

            state.namespaces[namespace] = {
                roots: tree.roots as unknown as MenuItemLive[],
                lastUpdated: typeof timestamp === 'string' ? timestamp : new Date(timestamp as unknown as number).toISOString()
            };
        }
    }
});

export const { menuTreeUpdated } = menuSlice.actions;
export default menuSlice.reducer;
