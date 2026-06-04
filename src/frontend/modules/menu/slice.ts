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
import { getRuntimeConfig } from '../../lib/runtimeConfig';
import type { IMenuNamespaceConfig } from './types';

/**
 * Lifecycle of the initial namespace-config fetch.
 *
 * Tracked per-namespace so the hook can stop dispatching after a
 * terminal state — without this, a rejected fetch leaves `config`
 * undefined and every subsequent render of any consumer would re-fire
 * the thunk, leaking requests until the user reloads.
 */
export type NamespaceConfigStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

/**
 * Per-namespace menu state.
 *
 * Tree (`roots` + `lastUpdated`) and rendering config (`config` plus its
 * fetch `configStatus`/`configError`) are tracked independently so a
 * tree mutation broadcast doesn't blow away a previously-loaded config
 * (and vice versa). All fields are optional — the namespace can show up
 * via any of the entry points (SSR tree seed, config fetch, WebSocket
 * update) and the reducers merge into whatever is already there.
 */
interface MenuNamespaceState {
    roots?: MenuNodeSerialized[];
    lastUpdated?: string;
    config?: IMenuNamespaceConfig;
    configStatus?: NamespaceConfigStatus;
    configError?: string;
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
        // Use the runtime config helper (not the deprecated build-time
        // `getApiUrl`) so the same Docker image works across domains —
        // see `docs/frontend/frontend.md` for the universal-image rule.
        const { apiUrl } = getRuntimeConfig();
        const url = `${apiUrl}/menu?namespace=${encodeURIComponent(namespace)}`;
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

/**
 * Fetch a namespace's rendering configuration on first consumer mount.
 *
 * The config endpoint is public, but credentials are sent for symmetry
 * with the tree refetch so any future per-user config gating works
 * without further plumbing. Subsequent updates arrive via the
 * `menu:namespace-config:update` WebSocket event handled in
 * SocketBridge.
 */
export const fetchNamespaceConfig = createAsyncThunk<
    { namespace: string; config: IMenuNamespaceConfig },
    { namespace: string },
    { rejectValue: string; state: { menu: MenuState } }
>('menu/fetchNamespaceConfig', async ({ namespace }, { rejectWithValue }) => {
    try {
        // Use the runtime config helper (not the deprecated build-time
        // `getApiUrl`) so the same Docker image works across domains —
        // see `docs/frontend/frontend.md` for the universal-image rule.
        const { apiUrl } = getRuntimeConfig();
        const url = `${apiUrl}/menu/namespace/${encodeURIComponent(namespace)}/config`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            return rejectWithValue(`config fetch failed: ${response.status}`);
        }
        const body = await response.json();
        const config = body?.config as IMenuNamespaceConfig | undefined;
        if (!config || !config.namespace) {
            return rejectWithValue('config payload missing or invalid');
        }
        // Reject if the response's namespace doesn't match what we
        // asked for — otherwise we would store mismatched config under
        // the requested key and consumers would silently render the
        // wrong namespace's settings.
        if (config.namespace !== namespace) {
            return rejectWithValue(
                `namespace mismatch: requested "${namespace}", server returned "${config.namespace}"`
            );
        }
        return { namespace, config };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'config fetch failed');
    }
}, {
    /**
     * Skip the dispatch if a fetch for this namespace is already in
     * flight or has already produced a terminal result. Without this,
     * concurrent mounts of `useMenuConfig` (which RTK does not dedupe
     * by default) would each fire the request, and a rejected attempt
     * would be retried on every render where the consumer's hook
     * dispatches again.
     */
    condition: ({ namespace }, { getState }) => {
        const status = getState().menu.namespaces[namespace]?.configStatus;
        return status !== 'loading' && status !== 'succeeded' && status !== 'failed';
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
            const existing = state.namespaces[namespace] ?? {};
            state.namespaces[namespace] = { ...existing, roots, lastUpdated: timestamp };
        },
        /**
         * Replace the config for `namespace`. Dispatched by SocketBridge on
         * receipt of `menu:namespace-config:update`, and by the
         * `fetchNamespaceConfig` thunk on initial load. Merges into any
         * tree state already held for the namespace so a config update
         * never wipes a freshly-loaded tree.
         */
        namespaceConfigSet(state, action: PayloadAction<{ namespace: string; config: IMenuNamespaceConfig }>) {
            const { namespace, config } = action.payload;
            const existing = state.namespaces[namespace] ?? {};
            state.namespaces[namespace] = { ...existing, config };
        }
    },
    extraReducers: (builder) => {
        builder.addCase(refetchMenuTree.fulfilled, (state, action) => {
            const { namespace, roots, timestamp } = action.payload;
            const existing = state.namespaces[namespace] ?? {};
            state.namespaces[namespace] = { ...existing, roots, lastUpdated: timestamp };
        });
        builder.addCase(fetchNamespaceConfig.pending, (state, action) => {
            const { namespace } = action.meta.arg;
            const existing = state.namespaces[namespace] ?? {};
            state.namespaces[namespace] = {
                ...existing,
                configStatus: 'loading',
                configError: undefined
            };
        });
        builder.addCase(fetchNamespaceConfig.fulfilled, (state, action) => {
            const { namespace, config } = action.payload;
            const existing = state.namespaces[namespace] ?? {};
            state.namespaces[namespace] = {
                ...existing,
                config,
                configStatus: 'succeeded',
                configError: undefined
            };
        });
        builder.addCase(fetchNamespaceConfig.rejected, (state, action) => {
            const { namespace } = action.meta.arg;
            const existing = state.namespaces[namespace] ?? {};
            // Terminal failure — record the error and let the hook fall
            // back to defaults with loading:false. We do not auto-retry
            // because retry on a permanently-bad endpoint would burn
            // requests on every consumer render.
            state.namespaces[namespace] = {
                ...existing,
                configStatus: 'failed',
                configError: action.payload ?? action.error.message ?? 'config fetch failed'
            };
        });
    }
});

export const { menuTreeSeeded, namespaceConfigSet } = menuSlice.actions;
export default menuSlice.reducer;
