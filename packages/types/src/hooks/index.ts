/**
 * @fileoverview Public type surface for the hook system.
 *
 * Re-exports the descriptor, registry, and per-plugin facade types so
 * consumers can import them from a single barrel.
 *
 * @see {@link ../../../../docs/system/system-hooks.md} for the conceptual
 *   contract these types encode — archetypes, lifecycle window, abort
 *   semantics, and admin introspection surface.
 * @module types/hooks
 */

export type {
    HookDescriptor,
    HookKind,
    HookPhase,
    HookPredicate,
    HookHandler,
    ObserverHookHandler,
    SeriesHookHandler,
    WaterfallHookHandler,
    BailHookHandler
} from './HookDescriptor.js';

export { HookAbortError, isHookAbortError } from './HookAbortError.js';

export type {
    IHookRegistry,
    IHookRegisterOptions,
    HookRegisterDisposer,
    IHookHandlerRecord,
    IHookSnapshotRecord,
    IHookSnapshot
} from './IHookRegistry.js';

export type { IPluginHooks } from './IPluginHooks.js';

export type { ICoreHooks, ICoreSsrHooks, ICoreAiHooks, ICoreHttpHooks, ICoreSchedulerHooks, ICoreContentHooks } from './ICoreHooks.js';

export type { IWalletLinkedContext } from './IWalletLinkedContext.js';

export type { ISyndicationDeliveredContext } from './ISyndicationDeliveredContext.js';

export type { IContentPublishedContext } from './IContentPublishedContext.js';
