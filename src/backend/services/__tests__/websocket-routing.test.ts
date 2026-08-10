/**
 * @file websocket-routing.test.ts
 *
 * Pins which connected sockets each core event reaches. `WebSocketService.emit`
 * dispatches on the event name through one long switch, so the difference
 * between "every browser on the site" and "signed-in admins only" is a single
 * `case` label sitting above the wrong `break`. That is easy to get wrong while
 * adding an unrelated event, and the mistake is invisible in review and in
 * manual testing — an over-broad emit still delivers to the intended surface,
 * it just also delivers everywhere else.
 *
 * These tests therefore assert the routing decision, not the delivery: a fake
 * Socket.IO server records whether `emit` was called globally or through
 * `to(room)`, and each case asserts the audience the event is supposed to have
 * plus the reason it has it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ADMIN_GROUP_ID } from '@/types';
import { WebSocketService } from '../websocket.service.js';

/** One recorded emission: the room it was addressed to, or null for global. */
interface IRecordedEmit {
    room: string | null;
    event: string;
    payload: unknown;
}

/**
 * Build a stand-in for the Socket.IO server that records the audience of every
 * emission instead of delivering it.
 *
 * @param sink - Array each emission is appended to.
 * @returns An object shaped like the slice of Socket.IO that `emit` touches.
 */
function createFakeIo(sink: IRecordedEmit[]) {
    return {
        /**
         * Record a global broadcast.
         *
         * @param event - Event name.
         * @param payload - Event payload.
         */
        emit(event: string, payload: unknown): void {
            sink.push({ room: null, event, payload });
        },
        /**
         * Record a room-addressed emission.
         *
         * @param room - The room (or rooms) addressed.
         * @returns An emitter that records against that room.
         */
        to(room: string | string[]) {
            return {
                /**
                 * Record the room-scoped emission.
                 *
                 * @param event - Event name.
                 * @param payload - Event payload.
                 */
                emit(event: string, payload: unknown): void {
                    sink.push({ room: Array.isArray(room) ? room.join(',') : room, event, payload });
                }
            };
        }
    };
}

describe('WebSocketService.emit — audience routing', () => {
    let emissions: IRecordedEmit[];
    let service: WebSocketService;

    beforeEach(() => {
        emissions = [];
        service = WebSocketService.getInstance();
        // The service holds its Socket.IO server privately and only ever
        // receives one via initialize(server), which needs a real HTTP server.
        // Swapping the field directly is what keeps this a unit test.
        (service as unknown as { io: unknown }).io = createFakeIo(emissions);
    });

    afterEach(() => {
        (service as unknown as { io: unknown }).io = undefined;
    });

    /**
     * Emit one event and return how it was addressed.
     *
     * @param event - The event name to dispatch.
     * @param payload - Payload to carry (irrelevant to routing, but realistic).
     * @returns The single recorded emission.
     */
    function emitOne(event: string, payload: unknown = { timestamp: '2026-01-01T00:00:00.000Z' }): IRecordedEmit {
        service.emit({ event, payload });
        expect(emissions).toHaveLength(1);
        return emissions[0];
    }

    describe('admin-only refetch nudges', () => {
        const ADMIN_ROOM = `group:${ADMIN_GROUP_ID}`;

        it.each([
            'ai-tools:activity',
            'ai-tools:approvals-changed',
            'curation:changed',
            'price-history:stats'
        ])('routes %s to the admin group room, never globally', (event) => {
            // Every subscriber to these lives under /system/*. A global emit
            // would hand anonymous visitors a timing signal for AI, curation,
            // and ingestion activity, and would widen the blast radius of any
            // future payload change from "admins" to "the public internet".
            const recorded = emitOne(event);

            expect(recorded.room).toBe(ADMIN_ROOM);
        });
    });

    describe('deliberately global events', () => {
        it('keeps account-history:stats global because a non-admin surface consumes it', () => {
            // WalletManager, on a signed-in user's own profile, refetches their
            // wallet sync progress off this nudge. Identity rooms address one
            // user or one group, so there is no "every authenticated socket"
            // room to narrow this to — scoping it to admins would silently
            // break the profile page.
            const recorded = emitOne('account-history:stats');

            expect(recorded.room).toBeNull();
        });

        it('keeps toast global — it is a site-wide announcement by design', () => {
            const recorded = emitOne('toast', { tone: 'info', title: 'Maintenance', duration: 6000 });

            expect(recorded.room).toBeNull();
        });

        it('keeps menu:update global because it changes what anonymous visitors render', () => {
            const recorded = emitOne('menu:update', { namespace: 'main', timestamp: 'now' });

            expect(recorded.room).toBeNull();
        });
    });

    describe('unknown events', () => {
        it('drops an unrecognised event rather than defaulting to a global broadcast', () => {
            // The switch has no catch-all emit, so a new event is inert until
            // someone adds a case and picks its audience on purpose. That is
            // the fail-safe direction: silent beats broadcast-to-everyone.
            service.emit({ event: 'not-a-real-event', payload: { secret: 'value' } });

            expect(emissions).toHaveLength(0);
        });
    });
});
