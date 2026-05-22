/**
 * @fileoverview Per-plugin hook facade.
 *
 * Each plugin receives an `IPluginHooks` instance wrapping the shared
 * `HookRegistry`. The facade tags registrations with the plugin id,
 * enforces the lifecycle window (registration permitted only while the
 * facade is open), and collects disposers so the plugin loader can
 * drop every handler on `disable()` without each plugin tracking them
 * by hand.
 *
 * @module backend/hooks/plugin-hooks
 */

import type {
    HookDescriptor,
    HookHandler,
    HookKind,
    IHookRegisterOptions,
    IHookRegistry,
    HookRegisterDisposer,
    IPluginHooks,
    ICoreHooks,
    ISystemLogService
} from '@/types';
import { HOOKS } from './registry.js';

/**
 * Concrete per-plugin facade. One instance per plugin per process.
 */
export class PluginHooks implements IPluginHooks {
    /** Disposers for every handler registered through this facade. */
    private readonly disposers: Set<HookRegisterDisposer> = new Set();

    /** Whether registration is still permitted. */
    private open: boolean = true;

    /**
     * Reference to the central declared-hook registry, exposed so plugin
     * code can write `context.hooks.HOOKS.ssr.headFragments` without
     * needing a TypeScript path alias into core. Identity-equal to the
     * `HOOKS` object minted in `registry.ts`, so the runtime
     * known-descriptor check sees the same references.
     */
    readonly HOOKS: ICoreHooks = HOOKS;

    /**
     * Construct a facade scoped to a plugin.
     *
     * @param pluginId - Owning plugin id, used to tag every registration.
     * @param registry - Shared process-wide hook registry.
     * @param logger - Plugin-scoped logger.
     */
    constructor(
        private readonly pluginId: string,
        private readonly registry: IHookRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Register a handler against a declared hook descriptor.
     *
     * @template I - Input payload type.
     * @template O - Output value type.
     * @template K - Hook kind discriminator.
     * @param descriptor - Descriptor from the central HOOKS registry.
     * @param handler - Handler function whose signature is inferred
     *   from the descriptor.
     * @param options - Optional priority override.
     * @returns Disposer that removes this specific registration. The
     *   facade also tracks it internally so `closeAndDisposeAll` removes
     *   it without the plugin retaining the reference.
     */
    register<I, O, K extends HookKind>(
        descriptor: HookDescriptor<I, O, K>,
        handler: HookHandler<I, O, K>,
        options?: IHookRegisterOptions
    ): HookRegisterDisposer {
        if (!this.open) {
            throw new Error(
                `Plugin '${this.pluginId}' attempted to register a handler against '${descriptor.id}' ` +
                `after its lifecycle window closed. Hook registration is permitted only during ` +
                `install/enable/init — register at startup, not inside request handlers.`
            );
        }

        const disposer = this.registry.register(this.pluginId, descriptor, handler, options);
        const wrapped: HookRegisterDisposer = () => {
            this.disposers.delete(wrapped);
            disposer();
        };
        this.disposers.add(wrapped);

        return wrapped;
    }

    /**
     * Close the lifecycle window without disposing handlers.
     *
     * Called by the platform after install/enable/init finish so any
     * later `register()` attempt throws. Idempotent.
     */
    seal(): void {
        this.open = false;
    }

    /**
     * Close the facade and drop every handler it owns.
     *
     * Invoked by the plugin loader on `disable()` and `uninstall()`.
     * After this returns, subsequent `register()` calls throw.
     *
     * @returns Count of handlers removed.
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
                    'Hook disposer threw during plugin disable'
                );
            }
        }

        return snapshot.length;
    }
}
