/**
 * @file notification-channel-sink.test.ts
 *
 * Covers the channel→router-sink adapter: it namespaces the sink id, declares
 * the empty router floor (not the channel's capability ceiling), passes the
 * channel's reach through, and refuses direct router-driven delivery so callers
 * are pushed through the notifications dispatch pipeline instead.
 */

import { describe, it, expect } from 'vitest';
import type { INotificationChannel } from '@/types';
import { notificationChannelToSink, NOTIFICATION_SINK_ID_PREFIX, channelIdFromSinkId } from '../channels/notification-channel-sink.js';

/** A channel with a non-trivial ceiling, so the floor/ceiling distinction is visible. */
function fakeChannel(): INotificationChannel {
    return {
        id: 'toast',
        label: 'Toast',
        accepts: ['title', 'body'],
        reach: { egress: 'user', audience: 'user' },
        deliver: async () => ({ delivered: 0 })
    };
}

describe('notification channel sink adapter', () => {
    it('maps a channel to a namespaced sink at the empty floor, passing reach through', () => {
        const sink = notificationChannelToSink(fakeChannel());

        expect(sink.id).toBe(`${NOTIFICATION_SINK_ID_PREFIX}:toast`);
        // The router floor — deliberately not the channel's ['title','body'] ceiling.
        expect(sink.accepts).toEqual([]);
        expect(sink.reach).toEqual({ egress: 'user', audience: 'user' });
    });

    it('refuses direct router-driven delivery, pointing at the dispatch pipeline', async () => {
        const sink = notificationChannelToSink(fakeChannel());

        await expect(sink.deliver({}, {})).rejects.toThrow(/dispatch pipeline/);
    });
});

describe('channelIdFromSinkId', () => {
    it('recovers the channel id from a notification sink id', () => {
        expect(channelIdFromSinkId(`${NOTIFICATION_SINK_ID_PREFIX}:toast`)).toBe('toast');
    });

    it('returns null for another family\'s sink id', () => {
        expect(channelIdFromSinkId('curation:gate')).toBeNull();
    });
});
