'use client';

/**
 * @fileoverview Core-owned file-picker registry — the runtime seam that makes
 * the file picker "core interface, provider-delivered."
 *
 * Core owns the interface (`context.useFilePicker()`); the concrete picker UI is
 * delivered at runtime by whichever files-provider plugin is enabled. This
 * module is the single active-provider slot plus a subscriber set for reactive
 * availability — a module singleton (like `getSocket()`) rather than React
 * state, because `createPluginContext()` is a stateless factory that cannot hold
 * hooks. A provider registers from its side-effect component (which mounts only
 * while the plugin is enabled), so disabling the plugin withdraws the capability
 * automatically. Last registration wins, so "disable default, enable a better
 * one" swaps the picker cleanly. No backend URLs are resolved here — the
 * provider owns its own endpoints, so this module needs no runtime config.
 */

import { useSyncExternalStore, useMemo } from 'react';
import type {
    IFilePickerClient,
    IFilePickerProvider,
    IFilePickOptions,
    IFileSelection
} from '@/types';

/**
 * The one active provider, or null when none is registered. Written only by
 * client-side provider registrations (a plugin side-effect component after
 * hydration), so during SSR it is always null.
 */
let activeProvider: IFilePickerProvider | null = null;

/** Subscribers notified whenever the active provider changes, for reactive availability. */
const listeners = new Set<() => void>();

/**
 * Notify every subscriber that availability may have changed. Kept private so
 * the active-provider slot is mutated only through register/dispose.
 */
function notify(): void {
    for (const listener of listeners) {
        listener();
    }
}

/**
 * Register the calling frontend as the active picker provider and return a
 * disposer that withdraws it. Last registration wins so an operator can disable
 * the default provider and enable an alternative; the disposer only clears the
 * slot if this provider is still the active one, so a superseded provider's
 * later unmount cannot wipe the newer registration.
 *
 * @param provider - The provider whose `open()` the picker will delegate to.
 * @returns A disposer to call on unmount (plugin disable) to withdraw the picker.
 */
export function registerFilePickerProvider(provider: IFilePickerProvider): () => void {
    activeProvider = provider;
    notify();
    return () => {
        if (activeProvider === provider) {
            activeProvider = null;
            notify();
        }
    };
}

/**
 * Open the active provider's picker, or resolve null when no provider is
 * registered — so consumers can `await pick()` uniformly and treat "no files
 * provider enabled" the same as a user cancel.
 *
 * @param options - Advisory picker options (accept hints, title, upload toggle).
 * @returns The user's selection, or null on cancel or when unavailable.
 */
export async function openFilePicker(options?: IFilePickOptions): Promise<IFileSelection | null> {
    return activeProvider ? activeProvider.open(options) : null;
}

/**
 * Subscribe to availability changes for `useSyncExternalStore`.
 *
 * @param listener - Called when the active provider is registered or withdrawn.
 * @returns An unsubscribe function.
 */
function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Client availability snapshot — whether a provider is currently registered.
 *
 * @returns True when a files provider is active.
 */
function getIsAvailable(): boolean {
    return activeProvider !== null;
}

/**
 * Server availability snapshot. Providers register only on the client after
 * hydration, so the server (and the first client render) always report false —
 * keeping SSR and first paint identical and avoiding a hydration mismatch.
 *
 * @returns Always false.
 */
function getServerIsAvailable(): boolean {
    return false;
}

/**
 * Core `useFilePicker` hook injected onto every plugin/frontend context. Wraps
 * the singleton so `isAvailable` is reactive (a consumer's "choose file" control
 * appears/disappears as the provider plugin is enabled/disabled) while `pick`
 * and `registerProvider` stay stable module references.
 *
 * @returns The files client: reactive `isAvailable`, plus `pick`/`registerProvider`.
 */
export function useFilePicker(): IFilePickerClient {
    const isAvailable = useSyncExternalStore(subscribe, getIsAvailable, getServerIsAvailable);
    return useMemo(() => ({
        pick: openFilePicker,
        isAvailable,
        registerProvider: registerFilePickerProvider
    }), [isAvailable]);
}
