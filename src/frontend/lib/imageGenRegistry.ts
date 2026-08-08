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
 * Collapse the two reference-image fields into just `referenceImages` so every
 * provider reads one canonical shape and none has to know the deprecated
 * singular `referenceImage` ever existed. Keeping this compat shim in core — one
 * place — is what lets the singular field stay supported for existing callers
 * without taxing every current and future provider with the same branch.
 *
 * A non-empty `referenceImages` wins outright, so a consumer that has migrated
 * is never second-guessed. The singular field is consulted only when the plural
 * one is absent or empty, and nullish entries are dropped from either field
 * rather than reaching a provider as a `[null]` it would have to defend against
 * — a multi-slot reference UI with an unfilled slot would otherwise both inflate
 * the count (routing an edit to compose) and crash the provider's `fileId` read.
 *
 * The singular field is then *mirrored* rather than blanked, because providers
 * are independently versioned packages: one still pinned to a types release
 * predating `referenceImages` compiles fine while reading only `referenceImage`,
 * so clearing it would silently drop the reference and hand the user an
 * unrelated from-scratch image. Mirroring applies only at exactly one reference
 * — the sole case the singular field expresses faithfully. Composition from
 * several has no singular equivalent, leaving it the one capability such a
 * provider cannot serve.
 *
 * @param options - Caller options, possibly using either or both reference fields.
 * @returns Equivalent options whose canonical references live in `referenceImages`.
 */
function normalizeReferences(options: IImageGenOptions): IImageGenOptions {
    const plural = (options.referenceImages ?? []).filter(Boolean);
    const single = options.referenceImage;
    const references = plural.length > 0 ? plural : single ? [single] : [];
    return {
        ...options,
        referenceImages: references,
        referenceImage: references.length === 1 ? references[0] : undefined
    };
}

/**
 * Generate through the active provider, or resolve null when none is registered
 * — so consumers can `await generate()` uniformly and treat "no image provider
 * enabled" as a graceful no-op. A registered provider that fails rejects, so the
 * consumer can surface the reason.
 *
 * Options are normalized first so the provider receives references only in
 * `referenceImages`, whichever field the caller used.
 *
 * @param options - The prompt, any reference images, plus advisory provider options.
 * @returns The persisted image selection, or null when unavailable.
 */
export async function generateImage(options: IImageGenOptions): Promise<IFileSelection | null> {
    return activeProvider ? activeProvider.generate(normalizeReferences(options)) : null;
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
