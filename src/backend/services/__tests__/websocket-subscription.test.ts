/**
 * @file websocket-subscription.test.ts
 *
 * Pins how the WebSocket layer treats what clients send. On 29 Sep 2026 a
 * single `subscribe` with no arguments crashed the production backend: the
 * handler read a property off `undefined` inside an async listener nobody
 * awaited, and the rejection stopped the process. These tests cover that
 * input class, the per-socket limits added alongside the fix, and the plugin
 * rejection contract — a handler that throws must leave the socket outside
 * the room and must not leak its error text to the client.
 *
 * The sockets are small fakes holding a `rooms` set, because the code under
 * test only joins, leaves, emits, and reads `data`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ISystemLogService, PluginSubscriptionHandler } from '@/types';
import {
    WebSocketService,
    MAX_CLIENT_ROOMS_PER_SOCKET,
    MAX_ROOM_NAME_LENGTH,
    SUBSCRIBE_RATE_MAX_EVENTS,
    SUBSCRIBE_RATE_WINDOW_MS,
    consumeSubscribeBudget,
    isValidRoomToken
} from '../websocket.service.js';
import { PluginWebSocketManager, GENERIC_SUBSCRIPTION_ERROR_MESSAGE } from '../plugin-websocket-manager.js';
import { PluginWebSocketRegistry } from '../plugin-websocket-registry.js';

/** The slice of a Socket.IO socket the subscription code touches. */
interface IFakeSocket {
    id: string;
    data: Record<string, unknown>;
    rooms: Set<string>;
    join(room: string): void;
    leave(room: string): void;
    emit: ReturnType<typeof vi.fn>;
}

/**
 * Build a fake socket whose room membership can be inspected.
 *
 * @returns A socket that starts in its own id room, as Socket.IO sockets do.
 */
function createSocket(): IFakeSocket {
    const socket: IFakeSocket = {
        id: 'sock-1',
        data: {},
        rooms: new Set(['sock-1']),
        join(room: string) {
            socket.rooms.add(room);
        },
        leave(room: string) {
            socket.rooms.delete(room);
        },
        emit: vi.fn()
    };
    return socket;
}

/**
 * Build a logger whose methods are spies, for the plugin manager.
 *
 * @returns A logger the manager can call freely.
 */
function createLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: () => logger
    } as unknown as ISystemLogService;
    return logger;
}

/** Private handler signatures reached directly, as the existing WebSocket tests do. */
interface IHandlers {
    handleSubscription(socket: unknown, a?: unknown, b?: unknown, c?: unknown): Promise<void>;
    handleUnsubscribe(socket: unknown, a?: unknown, b?: unknown, c?: unknown): Promise<void>;
}

describe('WebSocketService subscription handling', () => {
    let service: IHandlers;
    let handler: ReturnType<typeof vi.fn<PluginSubscriptionHandler>>;

    beforeEach(() => {
        service = WebSocketService.getInstance() as unknown as IHandlers;
        handler = vi.fn<PluginSubscriptionHandler>(async () => undefined);
        const manager = new PluginWebSocketManager('forum', {} as never, createLogger());
        manager.onSubscribe(handler);
        PluginWebSocketRegistry.getInstance().register('forum', 'Forum', manager);
    });

    afterEach(() => {
        PluginWebSocketRegistry.getInstance().clear();
    });

    describe('malformed input', () => {
        it.each([
            ['no arguments', []],
            ['null', [null]],
            ['a number', [42]],
            ['an array', [['x']]],
            ['an object with wrongly typed legacy keys', [{ notifications: { wallet: 1 }, markets: { markets: 'x' } }]],
            ['a plugin id with an object room name', ['forum', { $gt: '' }, null]]
        ])('resolves without throwing for %s', async (_label, args) => {
            const socket = createSocket();

            await expect(service.handleSubscription(socket, ...(args as unknown[]))).resolves.toBeUndefined();
            await expect(service.handleUnsubscribe(socket, ...(args as unknown[]))).resolves.toBeUndefined();
        });

        it('ignores a room name that is too long or has characters outside the allowed set', async () => {
            const socket = createSocket();

            await service.handleSubscription(socket, 'forum', 'x'.repeat(MAX_ROOM_NAME_LENGTH + 1));
            await service.handleSubscription(socket, 'forum', 'bad room\u0000');

            expect(handler).not.toHaveBeenCalled();
            expect([...socket.rooms]).toEqual(['sock-1']);
        });

        it('no longer joins the removed legacy rooms', async () => {
            const socket = createSocket();

            await service.handleSubscription(socket, {
                notifications: { wallet: 'TXYZ' },
                transactions: { addresses: ['TXYZ'], minAmount: 1 },
                comments: { resourceId: 'abc' },
                chat: true,
                markets: { all: true }
            });

            expect([...socket.rooms]).toEqual(['sock-1']);
        });

        it('still honours the legacy memos.all subscription, which has a live emitter', async () => {
            const socket = createSocket();

            await service.handleSubscription(socket, { memos: { all: true } });

            expect(socket.rooms.has('memos:all')).toBe(true);
        });
    });

    describe('limits', () => {
        it('refuses a new room once the socket holds the maximum, and tells the client', async () => {
            const socket = createSocket();
            for (let i = 0; i < MAX_CLIENT_ROOMS_PER_SOCKET; i++) {
                socket.rooms.add(`plugin:forum:room-${i}`);
            }

            await service.handleSubscription(socket, 'forum', 'one-too-many');

            expect(handler).not.toHaveBeenCalled();
            expect(socket.rooms.has('plugin:forum:one-too-many')).toBe(false);
            expect(socket.emit).toHaveBeenCalledWith('forum:subscription-error', {
                error: GENERIC_SUBSCRIPTION_ERROR_MESSAGE,
                pluginId: 'forum',
                roomName: 'one-too-many'
            });
        });

        it('does not count the socket id room or identity rooms toward the cap', async () => {
            const socket = createSocket();
            socket.rooms.add('user:u1');
            socket.rooms.add('group:admin');
            for (let i = 0; i < MAX_CLIENT_ROOMS_PER_SOCKET - 1; i++) {
                socket.rooms.add(`plugin:forum:room-${i}`);
            }

            await service.handleSubscription(socket, 'forum', 'last-slot');

            expect(socket.rooms.has('plugin:forum:last-slot')).toBe(true);
        });

        it('drops events beyond the per-socket budget until the window rolls over', () => {
            const socket = createSocket() as never;
            const start = 1_000_000;

            for (let i = 0; i < SUBSCRIBE_RATE_MAX_EVENTS; i++) {
                expect(consumeSubscribeBudget(socket, start)).toBe(true);
            }
            expect(consumeSubscribeBudget(socket, start + 1)).toBe(false);
            expect(consumeSubscribeBudget(socket, start + SUBSCRIBE_RATE_WINDOW_MS)).toBe(true);
        });

        it('accepts every room name in real use and rejects the rest', () => {
            expect(isValidRoomToken('cp-v1:TKHzFzZraC5c4Ug95mmTdTNCXTE31QJWFv')).toBe(true);
            expect(isValidRoomToken('pool-updates-24h')).toBe(true);
            expect(isValidRoomToken('')).toBe(false);
            expect(isValidRoomToken('a b')).toBe(false);
            expect(isValidRoomToken({})).toBe(false);
        });
    });

    describe('plugin rejection', () => {
        it('removes the socket from the room and sends a generic message when the handler throws', async () => {
            handler.mockRejectedValueOnce(new Error('MongoServerError: connection to 10.0.0.5 closed'));
            const socket = createSocket();

            await service.handleSubscription(socket, 'forum', 'forum-live');

            expect(socket.rooms.has('plugin:forum:forum-live')).toBe(false);
            expect(socket.emit).toHaveBeenCalledWith('forum:subscription-error', {
                error: GENERIC_SUBSCRIPTION_ERROR_MESSAGE,
                pluginId: 'forum',
                roomName: 'forum-live'
            });
        });

        it('shows the handler message when the error is marked expose: true', async () => {
            handler.mockRejectedValueOnce(Object.assign(new Error('Sign in to see this'), { expose: true }));
            const socket = createSocket();

            await service.handleSubscription(socket, 'forum', 'forum-live');

            expect(socket.emit).toHaveBeenCalledWith('forum:subscription-error', expect.objectContaining({
                error: 'Sign in to see this'
            }));
        });

        it('keeps the socket in the room when the handler accepts', async () => {
            const socket = createSocket();

            await service.handleSubscription(socket, 'forum', 'forum-live');

            expect(socket.rooms.has('plugin:forum:forum-live')).toBe(true);
        });
    });
});

describe('WebSocketService.disconnectUser', () => {
    let service: WebSocketService;
    let sockets: Array<{ data: unknown; disconnect: ReturnType<typeof vi.fn> }>;
    let requestedRoom: string | null;

    beforeEach(() => {
        service = WebSocketService.getInstance();
        requestedRoom = null;
        sockets = [
            { data: { authSession: { session: { id: 'session-a' } } }, disconnect: vi.fn() },
            { data: { authSession: { session: { id: 'session-b' } } }, disconnect: vi.fn() }
        ];
        (service as unknown as { io: unknown }).io = {
            /**
             * Record which room was asked for and hand back the fake sockets.
             *
             * @param room - The room the service asked about.
             * @returns An object exposing fetchSockets, as Socket.IO's does.
             */
            in(room: string) {
                requestedRoom = room;
                return { fetchSockets: async () => sockets };
            }
        };
    });

    afterEach(() => {
        (service as unknown as { io: unknown }).io = undefined;
    });

    it('drops every socket of the user when no session is named', async () => {
        await service.disconnectUser('u1');

        expect(requestedRoom).toBe('user:u1');
        expect(sockets[0].disconnect).toHaveBeenCalledWith(true);
        expect(sockets[1].disconnect).toHaveBeenCalledWith(true);
    });

    it('drops only the sockets opened with the named session', async () => {
        await service.disconnectUser('u1', 'session-b');

        expect(sockets[0].disconnect).not.toHaveBeenCalled();
        expect(sockets[1].disconnect).toHaveBeenCalledWith(true);
    });
});
