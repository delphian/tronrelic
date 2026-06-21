/**
 * @fileoverview The toast delivery channel — the only channel today.
 *
 * Maps each resolved recipient to their `user:${userId}` socket room and emits
 * one `notification` event carrying display-only fields. The dispatch pipeline
 * has already filtered out recipients who silenced this (category, channel), so
 * the rooms this channel receives are exactly the people who should see it —
 * per-user silencing is enforced before the event reaches the wire. Email/push
 * are future channels implementing the same {@link INotificationChannel}.
 */

import type { INotificationChannel, INotificationRecipient, IRenderedNotification, IChannelDeliveryResult, NotificationContentFeature } from '@/types';
import { TOAST_CHANNEL_ID, TOAST_CHANNEL_LABEL } from '../config.js';

/**
 * Minimal emitter contract the toast channel needs — satisfied by
 * `WebSocketService`. Declared narrowly so the channel does not couple to the
 * full service surface and stays trivially mockable in tests.
 */
export interface INotificationEmitter {
    emit(event: unknown): void;
}

/**
 * Delivers notifications as in-app toasts over WebSocket.
 */
export class ToastChannel implements INotificationChannel {
    readonly id = TOAST_CHANNEL_ID;
    readonly label = TOAST_CHANNEL_LABEL;

    /**
     * A toast frames a headline and an optional body. It cannot render inline
     * media or a labelled-fields table, so dispatch skips a toast for any
     * notification whose descriptor carries those — they belong to a richer
     * future channel (email/push), not a transient toast.
     */
    readonly accepts: NotificationContentFeature[] = ['title', 'body'];

    /**
     * @param emitter - WebSocket emitter (the core `WebSocketService`).
     */
    constructor(private readonly emitter: INotificationEmitter) {}

    /**
     * Emit one `notification` event to the recipients' identity rooms.
     *
     * @param recipients - Users who passed policy + preference gating for toast.
     * @param message - The rendered, channel-agnostic notification.
     * @returns Delivery count (one per resolved recipient room).
     */
    async deliver(recipients: INotificationRecipient[], message: IRenderedNotification): Promise<IChannelDeliveryResult> {
        if (recipients.length === 0) {
            return { delivered: 0 };
        }

        const rooms = recipients.map((r) => `user:${r.userId}`);
        this.emitter.emit({
            event: 'notification',
            rooms,
            payload: {
                id: message.id,
                categoryId: message.categoryId,
                categoryLabel: message.categoryLabel,
                severity: message.severity,
                // Flatten the descriptor onto the established wire shape so the
                // client `NotificationHandler` is unchanged by the content-type model.
                title: message.content.title,
                body: message.content.body,
                createdAt: message.createdAt.toISOString(),
                data: message.data
            }
        });

        return { delivered: recipients.length };
    }
}
