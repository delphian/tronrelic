/**
 * @fileoverview Per-plugin widget-type facade.
 *
 * Each plugin receives an `IPluginWidgetTypes` instance wrapping the
 * shared `WidgetTypeRegistry`. The facade constructs descriptors via
 * `defineWidgetType` on the plugin's behalf, tags every registration
 * with the plugin id, enforces the lifecycle window, and collects
 * disposers so the plugin loader can drop every declared type on
 * `disable()` without each plugin tracking them by hand.
 *
 * Mirrors `PluginZones` and `PluginHooks` so plugin authors learn one
 * pattern for participating in extension surfaces.
 *
 * @module backend/modules/widgets/widget-types/plugin-widget-types
 */

import type {
    IDefineWidgetTypeOptions,
    IPluginWidgetTypes,
    IWidgetTypeRegistry,
    WidgetTypeRegisterDisposer,
    ISystemLogService
} from '@/types';
import { defineWidgetType } from './define-widget-type.js';

/**
 * Concrete per-plugin facade. One instance per plugin per process.
 */
export class PluginWidgetTypes implements IPluginWidgetTypes {
    private readonly disposers: Set<WidgetTypeRegisterDisposer> = new Set();
    private open: boolean = true;

    /**
     * @param pluginId - Owning plugin id, used to tag every registration.
     * @param registry - Shared process-wide widget-type registry.
     * @param logger - Plugin-scoped logger.
     */
    constructor(
        private readonly pluginId: string,
        private readonly registry: IWidgetTypeRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Declare a widget type owned by this plugin.
     */
    register(options: IDefineWidgetTypeOptions): WidgetTypeRegisterDisposer {
        if (!this.open) {
            throw new Error(
                `Plugin '${this.pluginId}' attempted to declare widget type '${options.id}' ` +
                `after its lifecycle window closed. Widget-type registration is permitted only ` +
                `during install/enable/init — declare types at startup, not inside request handlers.`
            );
        }

        const descriptor = defineWidgetType(options);
        const disposer = this.registry.register(this.pluginId, descriptor);
        const wrapped: WidgetTypeRegisterDisposer = () => {
            this.disposers.delete(wrapped);
            disposer();
        };
        this.disposers.add(wrapped);

        return wrapped;
    }

    /**
     * Close the lifecycle window without disposing declared types.
     * Idempotent.
     */
    seal(): void {
        this.open = false;
    }

    /**
     * Close the facade and drop every widget type it owns. Invoked
     * by the plugin loader on `disable()` and `uninstall()`.
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
                    'Widget-type disposer threw during plugin disable'
                );
            }
        }

        return snapshot.length;
    }
}
