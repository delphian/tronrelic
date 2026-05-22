/**
 * @fileoverview Per-plugin hook facade exposed via IPluginContext.
 *
 * Plugins never touch the global `IHookRegistry` directly. They receive
 * an `IPluginHooks` instance scoped to their plugin id, which tags every
 * registration, enforces the per-plugin handler cap surfaced from the
 * descriptor, and returns disposables that the loader collects on
 * `disable()`. This mirrors how the WebSocket manager is plugin-scoped
 * even though the underlying Socket.IO instance is shared.
 *
 * @module types/hooks/IPluginHooks
 */

import type { HookDescriptor, HookHandler, HookKind } from './HookDescriptor.js';
import type { IHookRegisterOptions, HookRegisterDisposer } from './IHookRegistry.js';
import type { ICoreHooks } from './ICoreHooks.js';

/**
 * Plugin-scoped view of the hook registry. Surfaced as `context.hooks`
 * in the plugin context.
 */
export interface IPluginHooks {
    /**
     * Reference to the central `HOOKS` registry from core, exposed on the
     * facade because plugins live in workspaces that have no TypeScript
     * path alias into `src/backend/hooks/`. The runtime descriptor objects
     * referenced through this property are the same instances the registry
     * tracks via `defineHook`'s known-descriptor set, so handler
     * registration passes the identity check.
     *
     * Plugin authors reach a seam through this chain:
     * `context.hooks.register(context.hooks.HOOKS.ssr.headFragments, handler)`.
     *
     * @example
     * ```typescript
     * init: async (context: IPluginContext) => {
     *     context.hooks.register(
     *         context.hooks.HOOKS.ssr.headFragments,
     *         async (_ssr, fragments) => [...fragments, myFragment]
     *     );
     * }
     * ```
     */
    readonly HOOKS: ICoreHooks;

    /**
     * Register a handler against a declared hook seam.
     *
     * The handler signature is inferred from the descriptor, so a typo
     * or signature mismatch is a compile-time error. Registration is
     * only valid during the plugin lifecycle (`install` / `enable` /
     * `init`); calling it from a request handler throws to enforce the
     * "no mid-request mutation of the pipeline" rule.
     *
     * @param descriptor - Hook descriptor obtained from the central
     *   `HOOKS` registry. The runtime validates that the descriptor is
     *   declared.
     * @param handler - Function whose signature matches the descriptor.
     * @param options - Optional priority override.
     * @returns Disposer that removes the registration. The loader tracks
     *   disposers per plugin so calling `disable()` on the plugin
     *   removes every handler it owns — the disposer is exposed for
     *   plugins that want finer-grained control, but is not required
     *   for correctness.
     *
     * @example
     * ```typescript
     * context.hooks.register(HOOKS.ssr.headFragments, async (ssrCtx, fragments) => {
     *     return [...fragments, { tag: 'link', rel: 'stylesheet', href: '/themes/active.css' }];
     * }, { priority: 100 });
     * ```
     */
    register<I, O, K extends HookKind>(
        descriptor: HookDescriptor<I, O, K>,
        handler: HookHandler<I, O, K>,
        options?: IHookRegisterOptions
    ): HookRegisterDisposer;
}
