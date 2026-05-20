/**
 * Redux-backed hook for the namespace rendering configuration.
 *
 * The slice is the single source of truth: `fetchNamespaceConfig` seeds
 * it on first consumer mount and the
 * `menu:namespace-config:update` WebSocket handler in `SocketBridge`
 * keeps it live. Every component that calls `useMenuConfig(ns)` reads
 * the same store entry, so a config saved in `/system/menu` propagates
 * to every connected tab without a refresh.
 *
 * Keeping the fetch inside a thunk (rather than a per-hook
 * `useEffect`) means multiple consumers of the same namespace share one
 * network call — Redux Toolkit's thunk middleware fires the underlying
 * fetch once and the slice merges the result for everyone.
 *
 * @example
 * ```tsx
 * function MyMenu() {
 *     const config = useMenuConfig('main');
 *     if (config.loading) return null;
 *     return <PriorityNav enabled={config.overflow?.enabled ?? true}>{items}</PriorityNav>;
 * }
 * ```
 */
'use client';

import { useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import { fetchNamespaceConfig } from '../slice';
import type { IMenuNamespaceConfig, IUseMenuConfigResult } from '../types';

/**
 * Defaults returned while the initial fetch is in flight.
 *
 * Mirror `MenuService.getNamespaceConfig`'s defaults so the rendered
 * navigation looks identical before and after the store hydrates.
 */
const DEFAULT_CONFIG: IMenuNamespaceConfig = {
    namespace: 'main',
    overflow: { enabled: true },
    icons: { enabled: true, position: 'left' },
    layout: { orientation: 'horizontal' }
};

/**
 * Read a namespace's rendering configuration from Redux, fetching it
 * on first consumer mount if the store doesn't have it yet. Subsequent
 * updates flow through SocketBridge's
 * `menu:namespace-config:update` handler.
 *
 * @param namespace - Menu namespace to read (defaults to 'main')
 * @returns Configuration plus a `loading` flag (true until first fetch resolves)
 */
export function useMenuConfig(namespace: string = 'main'): IUseMenuConfigResult {
    const dispatch = useAppDispatch();
    const stored = useAppSelector(state => state.menu.namespaces[namespace]?.config);
    const status = useAppSelector(state => state.menu.namespaces[namespace]?.configStatus);

    useEffect(() => {
        // Dispatch only on the first idle state. The thunk's `condition`
        // option also blocks duplicate work, but checking here keeps the
        // hook honest about its own intent and saves an unnecessary
        // dispatch on every render after the first fetch resolves.
        if (status === undefined || status === 'idle') {
            void dispatch(fetchNamespaceConfig({ namespace }));
        }
    }, [namespace, status, dispatch]);

    // Treat 'failed' as a terminal state and surface defaults with
    // loading:false so consumers stop showing fallback chrome. The
    // thunk's `condition` guard prevents re-dispatch from this hook,
    // so a transient failure is sticky until the page reloads — a
    // deliberate trade so we don't retry on every render.
    if (stored) {
        return { ...stored, loading: false };
    }
    if (status === 'failed') {
        return { ...DEFAULT_CONFIG, namespace, loading: false };
    }
    return { ...DEFAULT_CONFIG, namespace, loading: true };
}
