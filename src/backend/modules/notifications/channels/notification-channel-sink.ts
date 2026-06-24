/**
 * @file notification-channel-sink.ts
 *
 * Adapts a notification channel to a content-router sink so the central router —
 * and its `/system/content-router` introspection — see notification delivery as
 * a destination family. Notifications is the platform's *delivery sink family*:
 * each channel (toast today; email/push later) is one delivery outlet.
 *
 * Two choices encode where the migration currently stands.
 *
 * The sink's `accepts` is the router's *required-minimum floor*, not the
 * channel's capability *ceiling* — the two are inverted. The channel's `accepts`
 * field is a ceiling the legacy dispatch matches with `present ⊆ accepts` (a
 * channel must cover everything the content carries); a router sink's `accepts`
 * is a floor matched with `accepts ⊆ present` (the content must carry at least
 * what the sink needs). The settled migration maps the channel to the empty
 * floor (`[]`, a candidate for any content). The fidelity the ceiling enforced —
 * skipping a toast for content it cannot render — moves to a deliver-time
 * refusal when the dispatch cutover makes the router the matching authority and
 * retires the legacy ceiling check.
 *
 * `deliver()` is intentionally not wired. Delivering to a notification channel
 * requires the family's recipient resolution and per-user opt-out, producing a
 * notification envelope the generic router cannot supply, so delivery flows
 * through the notifications dispatch pipeline rather than this sink. Until the
 * cutover the sink exists for classification-gate admission, structural
 * matching, and introspection; its `deliver` refuses — documenting the boundary
 * rather than silently dropping the effect.
 *
 * @see ../../../../../docs/system/system-content-routing.md — the sink contract
 *   and the accepts-direction the floor follows.
 */

import type { IContentDescriptor, IContentSink, INotificationChannel } from '@/types';

/** Prefix namespacing a channel's router sink id as `notifications:<channelId>`. */
export const NOTIFICATION_SINK_ID_PREFIX = 'notifications';

/**
 * Recover the channel id from a router sink id, or null when the id is not a
 * notification sink. The inverse of {@link notificationChannelToSink}'s id
 * construction, used by dispatch to map the router's candidate sinks back to
 * channels and ignore other families' sinks (the curation gate, future publish
 * sinks) returned by the same shared router.
 *
 * @param sinkId - A router sink id.
 * @returns The channel id, or null when `sinkId` is not `notifications:<channelId>`.
 */
export function channelIdFromSinkId(sinkId: string): string | null {
    const prefix = `${NOTIFICATION_SINK_ID_PREFIX}:`;
    return sinkId.startsWith(prefix) ? sinkId.slice(prefix.length) : null;
}

/**
 * Build a content-router sink that advertises a notification channel.
 *
 * The channel is passed in rather than looked up so the adapter stays a pure
 * mapping the module and its tests call directly, with no registry coupling.
 *
 * @param channel - The channel whose id and reach the sink mirrors.
 * @returns The content sink representing the channel on the router.
 */
export function notificationChannelToSink(channel: INotificationChannel): IContentSink {
    const sink: IContentSink = {
        id: `${NOTIFICATION_SINK_ID_PREFIX}:${channel.id}`,
        kind: 'delivery',
        accepts: [],
        reach: channel.reach,

        /**
         * Refuse direct router-driven delivery. A notification channel is
         * delivered to through the notifications dispatch pipeline, which resolves
         * the audience to recipients and enforces per-user opt-out before handing
         * the channel a notification envelope the generic router does not carry.
         * Routing delivery through this sink is the dispatch-cutover phase and
         * depends on the deferred deliver-result contract; until then this guards
         * the boundary rather than fabricate a partial delivery.
         *
         * @param _content - The descriptor a generic dispatcher would deliver; unused.
         * @param _dest - Destination config; unused.
         * @returns Never resolves — always throws.
         */
        async deliver(_content: IContentDescriptor, _dest: Record<string, unknown>): Promise<void> {
            throw new Error(
                `Notification channel sink '${channel.id}' cannot be delivered through the content router directly: ` +
                'notification delivery flows through the notifications dispatch pipeline (recipient resolution and ' +
                'per-user opt-out). The router sink is registered for classification, structural matching, and ' +
                'introspection until the dispatch cutover.'
            );
        }
    };

    return sink;
}
