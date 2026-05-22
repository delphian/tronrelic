/**
 * @fileoverview Public barrel for the backend hook system.
 *
 * Re-exports the declared-hook registry, the runtime classes, the
 * per-plugin facade, and the invocation engine so core call sites and
 * the plugin loader can import everything from a single path.
 *
 * @see {@link ../../../docs/system/system-hooks.md} for the conceptual
 *   overview: why hooks exist, the four archetypes, declared seams,
 *   plugin facade lifecycle, and admin introspection.
 * @module backend/hooks
 */

export { HOOKS, type Hooks } from './registry.js';
export { defineHook, isKnownDescriptor, listKnownDescriptors, type IDefineHookOptions } from './define-hook.js';
export { HookRegistry } from './hook-registry.js';
export { PluginHooks } from './plugin-hooks.js';
export {
    invokeHook,
    invokeObserver,
    invokeSeries,
    invokeWaterfall,
    invokeBail,
    orderHandlers,
    type IRegisteredHandler
} from './invoke.js';
export { HooksController, createHooksAdminRouter, SsrHeadFragmentsController, SsrHtmlAttributesController, createSsrRouter } from './api/index.js';
