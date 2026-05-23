/**
 * @fileoverview Per-plugin widget-type facade exposed via IPluginContext.
 *
 * Plugins never touch the global `IWidgetTypeRegistry` directly. They
 * receive an `IPluginWidgetTypes` instance scoped to their plugin id,
 * which constructs descriptors via `defineWidgetType` on the plugin's
 * behalf, tags every registration with the plugin id, enforces the
 * lifecycle window (registration permitted only while the facade is
 * open), and collects disposers so the plugin loader can drop every
 * declared type on `disable()` without the plugin tracking them by
 * hand.
 *
 * Mirrors the shape of `IPluginZones` and `IPluginHooks` so plugin
 * code learns one pattern for participating in extension surfaces.
 *
 * @module types/widget-types/IPluginWidgetTypes
 */

import type {
    IDefineWidgetTypeOptions,
    WidgetTypeRegisterDisposer
} from './IWidgetType.js';

/**
 * Plugin-scoped view of the widget-type registry. Surfaced as
 * `context.widgetTypes` in the plugin context.
 */
export interface IPluginWidgetTypes {
    /**
     * Declare a widget type owned by this plugin.
     *
     * Plugins declare widget types to publish renderable widgets the
     * operator can place across zones. Each type contributes a single
     * SSR data fetcher (`defaultDataFetcher`); the resolver invokes
     * the fetcher once per placement at render time.
     *
     * Registration is only valid during the plugin lifecycle
     * (`install` / `enable` / `init`). Calling it from a request
     * handler throws — there is no mid-request mutation of the
     * widget-type catalog.
     *
     * If a type with the same id is already registered to a different
     * plugin, the call throws. The disposer returned removes only
     * this plugin's claim.
     *
     * @param options - Widget-type configuration. The descriptor is
     *   constructed on the plugin's behalf with the plugin id tagged
     *   automatically.
     * @returns Disposer that removes this specific registration. The
     *   loader tracks disposers per plugin so calling `disable()` on
     *   the plugin removes every type it owns; the disposer is
     *   exposed for finer-grained control but is not required for
     *   correctness.
     *
     * @example
     * ```typescript
     * init: async (context: IPluginContext) => {
     *     context.widgetTypes.register({
     *         id: 'whale-alerts:recent',
     *         label: 'Recent Whale Activity',
     *         description: 'Latest large transactions on TRON network.',
     *         defaultDataFetcher: async () => {
     *             const cache = await context.database.findOne('feed', {});
     *             return { transactions: cache?.items ?? [] };
     *         }
     *     });
     * }
     * ```
     */
    register(options: IDefineWidgetTypeOptions): WidgetTypeRegisterDisposer;

    /**
     * Close the lifecycle window without disposing declared types.
     *
     * Called by the platform after `install` / `enable` / `init`
     * finish so any later `register()` attempt throws instead of
     * silently extending the plugin's surface. Types stay registered
     * for the plugin's enabled lifetime — only the open flag flips.
     *
     * Idempotent. Disable/uninstall paths instead invoke the
     * implementation's bulk-dispose method, which both seals and
     * drops every type.
     */
    seal(): void;
}
