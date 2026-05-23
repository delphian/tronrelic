/**
 * @fileoverview Per-plugin zone facade.
 *
 * Each plugin receives an `IPluginZones` instance wrapping the shared
 * `ZoneRegistry`. The facade constructs descriptors via `defineZone`
 * on the plugin's behalf, tags every registration with the plugin id,
 * enforces the lifecycle window (registration permitted only while the
 * facade is open), and collects disposers so the plugin loader can
 * drop every declared zone on `disable()` without each plugin tracking
 * them by hand.
 *
 * Mirrors `PluginHooks` so plugin authors learn one pattern for
 * participating in extension surfaces.
 *
 * @module backend/modules/widgets/zones/plugin-zones
 */

import type {
    IDefineZoneOptions,
    IPluginZones,
    IZoneRegistry,
    ZoneRegisterDisposer,
    ISystemLogService
} from '@/types';
import { defineZone } from './define-zone.js';

/**
 * Concrete per-plugin facade. One instance per plugin per process.
 */
export class PluginZones implements IPluginZones {
    /** Disposers for every zone registered through this facade. */
    private readonly disposers: Set<ZoneRegisterDisposer> = new Set();

    /** Whether registration is still permitted. */
    private open: boolean = true;

    /**
     * Construct a facade scoped to a plugin.
     *
     * @param pluginId - Owning plugin id, used to tag every registration.
     * @param registry - Shared process-wide zone registry.
     * @param logger - Plugin-scoped logger.
     */
    constructor(
        private readonly pluginId: string,
        private readonly registry: IZoneRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Declare a zone owned by this plugin.
     *
     * Constructs the descriptor through `defineZone` and registers it
     * with the shared registry tagged with this plugin's id. Plugins do
     * not import `defineZone` directly — passing options here is the
     * only sanctioned plugin path.
     *
     * @param options - Zone configuration.
     * @returns Disposer that removes this specific registration. The
     *   facade also tracks it internally so `closeAndDisposeAll` removes
     *   it without the plugin retaining the reference.
     * @throws Error if the lifecycle window has closed or the zone id
     *   is already claimed.
     */
    register(options: IDefineZoneOptions): ZoneRegisterDisposer {
        if (!this.open) {
            throw new Error(
                `Plugin '${this.pluginId}' attempted to declare zone '${options.id}' ` +
                `after its lifecycle window closed. Zone registration is permitted only ` +
                `during install/enable/init — declare zones at startup, not inside ` +
                `request handlers.`
            );
        }

        const descriptor = defineZone(options);
        const disposer = this.registry.register(this.pluginId, descriptor);
        const wrapped: ZoneRegisterDisposer = () => {
            this.disposers.delete(wrapped);
            disposer();
        };
        this.disposers.add(wrapped);

        return wrapped;
    }

    /**
     * Close the lifecycle window without disposing declared zones.
     *
     * Called by the platform after install/enable/init finish so any
     * later `register()` attempt throws. Idempotent.
     */
    seal(): void {
        this.open = false;
    }

    /**
     * Close the facade and drop every zone it owns.
     *
     * Invoked by the plugin loader on `disable()` and `uninstall()`.
     * After this returns, subsequent `register()` calls throw.
     *
     * @returns Count of zones removed.
     */
    closeAndDisposeAll(): number {
        this.open = false;
        const snapshot = Array.from(this.disposers);
        this.disposers.clear();
        for (const dispose of snapshot) {
            try {
                dispose();
            } catch (err) {
                this.logger.warn(
                    { err, pluginId: this.pluginId },
                    'Zone disposer threw during plugin disable'
                );
            }
        }

        return snapshot.length;
    }
}
