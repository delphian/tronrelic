/**
 * Menu Redux slice for live WebSocket-driven menu state.
 *
 * Per-user gating means the WebSocket can no longer broadcast a single tree
 * shape that fits every connected client. The server emits a refetch signal
 * (`{ namespace, nodeId, event, timestamp }`) and each client requests
 * `GET /api/menu` with its own credentials to receive the filtered view.
 *
 * The slice owns the post-refetch state: it stores tree roots per namespace
 * so components can overlay live state on top of SSR-provided menu items,
 * preserving the SSR + Live Updates pattern.
 */

import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { MenuNodeSerialized } from '@/shared';
import { getApiUrl } from '../../lib/config';

interface MenuNamespaceState {
    roots: MenuNodeSerialized[];
    lastUpdated: string;
}

export interface MenuState {
    /** Menu trees keyed by namespace (e.g., 'main', 'system'). */
    namespaces: Record<string, MenuNamespaceState>;
}

const initialState: MenuState = {
    namespaces: {}
};

/**
 * Re-fetch the user-filtered menu tree for a namespace.
 *
 * Triggered when the server emits a `menu:update` refetch signal. Sends
 * credentials so the cookie-resolved user identity reaches the gating
 * filter; without it the server would return the anonymous-visitor view
 * regardless of who is logged in.
 */
export const refetchMenuTree = createAsyncThunk<
    { namespace: string; roots: MenuNodeSerialized[]; timestamp: string },
    { namespace: string; timestamp: string },
    { rejectValue: string }
>('menu/refetchTree', async ({ namespace, timestamp }, { rejectWithValue }) => {
    try {
        const url = getApiUrl(`/menu?namespace=${encodeURIComponent(namespace)}`);
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            return rejectWithValue(`menu refetch failed: ${response.status}`);
        }
        const body = await response.json();
        const roots = (body?.tree?.roots ?? []) as MenuNodeSerialized[];
        return { namespace, roots, timestamp };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'menu refetch failed');
    }
});

const menuSlice = createSlice({
    name: 'menu',
    initialState,
    reducers: {
        /**
         * Seed the slice from server-rendered menu data.
         *
         * Lets pages dispatch their SSR-fetched tree into Redux on first
         * mount so subsequent refetches replace a known baseline rather
         * than appearing as the first state transition.
         */
        menuTreeSeeded(state, action: PayloadAction<{ namespace: string; roots: MenuNodeSerialized[]; timestamp: string }>) {
            const { namespace, roots, timestamp } = action.payload;
            state.namespaces[namespace] = { roots, lastUpdated: timestamp };
        }
    },
    extraReducers: (builder) => {
        builder.addCase(refetchMenuTree.fulfilled, (state, action) => {
            const { namespace, roots, timestamp } = action.payload;
            state.namespaces[namespace] = { roots, lastUpdated: timestamp };
        });
    }
});

export const { menuTreeSeeded } = menuSlice.actions;
export default menuSlice.reducer;
