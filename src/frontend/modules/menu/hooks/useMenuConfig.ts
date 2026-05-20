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

    useEffect(() => {
        if (!stored) {
            // Thunk middleware fires the network call once even if
            // multiple consumers mount in the same tick — the second
            // dispatch finds a fulfilled promise in the action cache.
            void dispatch(fetchNamespaceConfig({ namespace }));
        }
    }, [namespace, stored, dispatch]);

    if (!stored) {
        return { ...DEFAULT_CONFIG, namespace, loading: true };
    }
    return { ...stored, loading: false };
}
