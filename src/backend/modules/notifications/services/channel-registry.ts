/**
 * @fileoverview In-memory registry of delivery channel transports.
 *
 * A channel is a transport (toast today; email/push later) behind one
 * interface, so adding one is a new column in the preference matrix, not a new
 * concept. The module registers the built-in toast channel; a future channel
 * provider plugin registers its own. Like categories, channels are code held
 * for the process lifetime — only their admin enable-state persists.
 */

import type { INotificationChannel, INotificationChannelInfo, NotificationDisposer, ISystemLogService } from '@/types';

/**
 * Holds registered channel transports keyed by id. Registration returns a
 * disposer; re-registering an id replaces the transport.
 */
export class ChannelRegistry {
    private readonly channels = new Map<string, INotificationChannel>();

    /**
     * Optional side-effect paired with every channel registration — the module
     * sets it to advertise each channel as a content-router sink. Held as an
     * injected binder rather than a direct router dependency so the registry
     * stays transport-only and router-agnostic.
     */
    private sinkBinder?: (channel: INotificationChannel) => NotificationDisposer;

    /**
     * @param logger - Scoped logger for registration diagnostics.
     */
    constructor(private readonly logger: ISystemLogService) {}

    /**
     * Pair every channel registration with a side-effect run at register time and
     * undone at dispose time. The module uses it to register each channel's
     * content-router sink, so a channel registered at runtime (a future
     * email/push plugin calling `registerChannel` after startup) is advertised
     * and routable exactly like a startup channel — not silently skipped by
     * dispatch, which derives its candidates from the router. Set once during
     * module run before any channel registers, so the built-in and every runtime
     * channel are bound. Router-agnostic by design: the registry knows only "run
     * this on register, undo it on dispose."
     *
     * @param binder - Invoked per registered channel; its returned disposer is
     *   composed into the channel disposer so unregistering removes the sink too.
     */
    setSinkBinder(binder: (channel: INotificationChannel) => NotificationDisposer): void {
        this.sinkBinder = binder;
    }

    /**
     * Register (or replace) a channel transport.
     *
     * @param channel - The transport implementation.
     * @returns A disposer that removes this exact transport.
     */
    register(channel: INotificationChannel): NotificationDisposer {
        if (this.channels.has(channel.id)) {
            this.logger.warn({ channelId: channel.id }, 'Notification channel re-registered; replacing prior transport');
        }
        this.channels.set(channel.id, channel);
        // Run the paired registration side-effect (advertising the channel as a
        // content-router sink) so a channel registered at runtime is as routable
        // as one present at startup, and capture its disposer to undo it in
        // lockstep when the channel is unregistered.
        const sinkDisposer = this.sinkBinder?.(channel);
        this.logger.info({ channelId: channel.id }, 'Notification channel registered');

        return () => {
            if (this.channels.get(channel.id) === channel) {
                this.channels.delete(channel.id);
                sinkDisposer?.();
                this.logger.info({ channelId: channel.id }, 'Notification channel unregistered');
            }
        };
    }

    /**
     * Look up a channel transport by id.
     *
     * @param id - Channel id.
     * @returns The transport, or undefined when unregistered.
     */
    get(id: string): INotificationChannel | undefined {
        return this.channels.get(id);
    }

    /**
     * Whether a channel id is currently registered.
     *
     * @param id - Channel id.
     * @returns True when a transport is registered under the id.
     */
    has(id: string): boolean {
        return this.channels.has(id);
    }

    /**
     * Lightweight channel descriptors for listing in UIs without exposing the
     * transport.
     *
     * @returns Id/label pairs for every registered channel.
     */
    list(): INotificationChannelInfo[] {
        return Array.from(this.channels.values()).map((c) => ({ id: c.id, label: c.label }));
    }
}
