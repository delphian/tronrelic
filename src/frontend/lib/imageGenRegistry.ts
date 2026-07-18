'use client';

/**
 * @fileoverview Core-owned image-generation registry — the runtime seam that
 * makes prompt-to-image "core interface, provider-delivered."
 *
 * Core owns the interface (`context.useImageGen()`); the concrete generator is
 * delivered at runtime by whichever image-gen provider plugin is enabled. This
 * module is the single active-provider slot plus a subscriber set for reactive
 * availability — a module singleton (like `filePickerRegistry`) rather than
 * React state, because `createPluginContext()` is a stateless factory that
 * cannot hold hooks. A provider registers from its side-effect component (which
 * mounts only while the plugin is enabled), so disabling the plugin withdraws
 * the capability automatically. Last registration wins, so swapping providers is
 * clean. No backend URLs are resolved here — the provider owns its own endpoint,
 * so this module needs no runtime config.
 */

import { useSyncExternalStore, useMemo } from 'react';
import type {
    IImageGenClient,
    IImageGenProvider,
    IImageGenOptions,
    IFileSelection
} from '@/types';

/**
 * The one active provider, or null when none is registered. Written only by
 * client-side provider registrations (a plugin side-effect component after
 * hydration), so during SSR it is always null.
 */
let activeProvider: IImageGenProvider | null = null;

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
 * Register the calling frontend as the active image-gen provider and return a
 * disposer that withdraws it. Last registration wins so an operator can disable
 * the default provider and enable an alternative; the disposer only clears the
 * slot if this provider is still the active one, so a superseded provider's
 * later unmount cannot wipe the newer registration.
 *
 * @param provider - The provider whose `generate()` the seam will delegate to.
 * @returns A disposer to call on unmount (plugin disable) to withdraw the capability.
 */
export function registerImageGenProvider(provider: IImageGenProvider): () => void {
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
 * Generate through the active provider, or resolve null when none is registered
 * — so consumers can `await generate()` uniformly and treat "no image provider
 * enabled" as a graceful no-op. A registered provider that fails rejects, so the
 * consumer can surface the reason.
 *
 * @param options - The prompt plus advisory provider options.
 * @returns The persisted image selection, or null when unavailable.
 */
export async function generateImage(options: IImageGenOptions): Promise<IFileSelection | null> {
    return activeProvider ? activeProvider.generate(options) : null;
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
 * @returns True when an image-gen provider is active.
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
 * Core `useImageGen` hook injected onto every plugin/frontend context. Wraps the
 * singleton so `isAvailable` is reactive (a consumer's "generate" control
 * appears/disappears as the provider plugin is enabled/disabled) while
 * `generate` and `registerProvider` stay stable module references.
 *
 * @returns The image-gen client: reactive `isAvailable`, plus `generate`/`registerProvider`.
 */
export function useImageGen(): IImageGenClient {
    const isAvailable = useSyncExternalStore(subscribe, getIsAvailable, getServerIsAvailable);
    return useMemo(() => ({
        generate: generateImage,
        isAvailable,
        registerProvider: registerImageGenProvider
    }), [isAvailable]);
}
