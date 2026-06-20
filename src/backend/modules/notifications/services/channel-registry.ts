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
     * @param logger - Scoped logger for registration diagnostics.
     */
    constructor(private readonly logger: ISystemLogService) {}

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
        this.logger.info({ channelId: channel.id }, 'Notification channel registered');

        return () => {
            if (this.channels.get(channel.id) === channel) {
                this.channels.delete(channel.id);
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
