/**
 * @fileoverview Per-plugin zone facade exposed via IPluginContext.
 *
 * Plugins never touch the global `IZoneRegistry` directly. They receive
 * an `IPluginZones` instance scoped to their plugin id, which constructs
 * descriptors via `defineZone` on the plugin's behalf, tags every
 * registration with the plugin id, enforces the lifecycle window
 * (registration permitted only while the facade is open), and collects
 * disposers so the plugin loader can drop every declared zone on
 * `disable()` without the plugin tracking them by hand.
 *
 * Mirrors the shape of `IPluginHooks` so plugin code learns one pattern
 * for participating in extension surfaces.
 *
 * @module types/widget-zones/IPluginZones
 */

import type { IDefineZoneOptions, ZoneRegisterDisposer } from './IZoneDescriptor.js';

/**
 * Plugin-scoped view of the zone registry. Surfaced as `context.zones`
 * in the plugin context.
 */
export interface IPluginZones {
    /**
     * Declare a zone owned by this plugin.
     *
     * Plugins declare zones to expose injection points inside their own
     * pages — for example, a whale tracker plugin declaring
     * `whale-detail:sidebar` so other plugins can place widgets there.
     * Core zones are declared by the platform and reachable to placements
     * by string id; plugins do not redeclare them.
     *
     * Registration is only valid during the plugin lifecycle
     * (`install` / `enable` / `init`). Calling it from a request handler
     * throws — there is no mid-request mutation of the zone catalog.
     *
     * If a zone with the same id is already registered to a different
     * plugin, the call throws. The disposer returned removes only this
     * plugin's claim; if the plugin re-registers later, the same id is
     * available again.
     *
     * @param options - Zone configuration. The descriptor is constructed
     *   on the plugin's behalf with the plugin id tagged automatically.
     * @returns Disposer that removes this specific registration. The
     *   loader tracks disposers per plugin so calling `disable()` on the
     *   plugin removes every zone it owns — the disposer is exposed for
     *   finer-grained control but is not required for correctness.
     *
     * @example
     * ```typescript
     * init: async (context: IPluginContext) => {
     *     context.zones.register({
     *         id: 'whales:detail-sidebar',
     *         label: 'Whale detail sidebar',
     *         description: 'Right-side panel on individual whale pages.',
     *         host: 'plugin',
     *         layout: 'vertical'
     *     });
     * }
     * ```
     */
    register(options: IDefineZoneOptions): ZoneRegisterDisposer;

    /**
     * Close the lifecycle window without disposing declared zones.
     *
     * Called by the platform after `install` / `enable` / `init` finish,
     * so any later `register()` attempt throws instead of silently
     * extending the plugin's zone surface. Zones stay registered for the
     * plugin's enabled lifetime — only the open flag flips.
     *
     * Idempotent: calling `seal()` on an already-sealed facade is a
     * no-op. Disable/uninstall paths instead invoke the implementation's
     * bulk-dispose method, which both seals and drops every zone.
     */
    seal(): void;
}
