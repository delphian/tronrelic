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

import type { INotificationChannel, INotificationRecipient, IRenderedNotification, IChannelDeliveryResult, NotificationContentFeature, IContentClassification } from '@/types';
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
     * A toast renders to a signed-in user's in-app surface over WebSocket — it
     * never leaves the platform and reaches a regular user — so its content-router
     * reach is `{ egress: 'user', audience: 'user' }`. The router's classification
     * gate reads this to decide whether a class of content may be delivered as a
     * toast.
     */
    readonly reach: IContentClassification = { egress: 'user', audience: 'user' };

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
        // Fidelity refusal. The content router matches a toast on the empty floor,
        // so it is now a candidate for content carrying only media or details. A
        // toast frames a headline and an optional body — with neither a title nor
        // a body there is nothing to show, so refuse observably rather than emit a
        // category-label-only husk. Content that has a title or body still renders
        // best-effort, silently dropping media/details (supplementary, not the
        // message). The refusal is content-based, so it precedes the recipient
        // guard.
        if (!message.content.title && !message.content.body) {
            return { delivered: 0, refused: true };
        }

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
                // A descriptor may legitimately carry `body` with no `title`
                // (IContentDescriptor.title is optional); since the client drops any
                // notification without a title, fall back to the category label so a
                // body-only notification still surfaces instead of being silently
                // counted as delivered while the user sees nothing.
                title: message.content.title ?? message.categoryLabel,
                body: message.content.body,
                createdAt: message.createdAt.toISOString(),
                data: message.data
            }
        });

        return { delivered: recipients.length };
    }
}
