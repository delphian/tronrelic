/**
 * @file websocket-handshake.test.ts
 *
 * Covers how a connecting socket's identity is resolved, which became
 * load-bearing when admin-scoped events moved off the global broadcast: a
 * socket that fails to resolve its session joins no identity rooms, so a
 * signed-in operator connects successfully and then silently receives none of
 * the `group:admin` refetch nudges their dashboard depends on. Nothing on
 * screen reports it, and the client cannot detect it — its own session is
 * unchanged — so the recovery has to happen here, at the handshake.
 *
 * The distinction the retry rests on: an anonymous visitor resolves to `null`
 * without throwing, so a throw always means the auth tier faltered rather than
 * "no cookie present". These tests pin both halves — that a fault is retried,
 * and that an ordinary anonymous connection is not.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Controls what the auth facade does per attempt. Hoisted so the `vi.mock`
 * factory can close over it despite Vitest lifting the mock above the imports.
 */
const facade = vi.hoisted(() => ({
    getSessionFromHeaders: vi.fn()
}));

vi.mock('../../modules/identity/services/auth-facade.js', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getSessionFromHeaders: facade.getSessionFromHeaders
}));

import { WebSocketService } from '../websocket.service.js';

/** A resolved session shaped like the slice the room-joining code reads. */
const SESSION = { user: { id: 'user-1' }, session: {}, groups: ['admin'] };

describe('WebSocketService handshake session resolution', () => {
    /**
     * Invoke the private resolver directly. It is deliberately not public — the
     * handshake middleware is its only caller — but its retry policy is the
     * behaviour under test, and reaching it through `initialize()` would need a
     * real HTTP server and a real Socket.IO client.
     *
     * @returns The resolved session, or null.
     */
    async function resolve(): Promise<unknown> {
        const service = WebSocketService.getInstance() as unknown as {
            resolveHandshakeSession(headers: unknown, socketId: string): Promise<unknown>;
        };
        return service.resolveHandshakeSession({ cookie: 'session=abc' }, 'sock-1');
    }

    beforeEach(() => {
        facade.getSessionFromHeaders.mockReset();
    });

    it('returns the session when resolution succeeds first time', async () => {
        facade.getSessionFromHeaders.mockResolvedValueOnce(SESSION);

        await expect(resolve()).resolves.toEqual(SESSION);
        expect(facade.getSessionFromHeaders).toHaveBeenCalledTimes(1);
    });

    it('retries once and recovers when the first attempt throws', async () => {
        // The case the retry exists for: a momentary Better Auth / Mongo fault
        // would otherwise cost this operator their identity rooms for the whole
        // life of the socket.
        facade.getSessionFromHeaders
            .mockRejectedValueOnce(new Error('connection reset'))
            .mockResolvedValueOnce(SESSION);

        await expect(resolve()).resolves.toEqual(SESSION);
        expect(facade.getSessionFromHeaders).toHaveBeenCalledTimes(2);
    });

    it('degrades to null without throwing when both attempts fail', async () => {
        // Connected-but-anonymous beats refusing the handshake: rejecting would
        // drop anonymous visitors too, over a fault that only degrades
        // authenticated ones.
        facade.getSessionFromHeaders
            .mockRejectedValueOnce(new Error('down'))
            .mockRejectedValueOnce(new Error('still down'));

        await expect(resolve()).resolves.toBeNull();
        expect(facade.getSessionFromHeaders).toHaveBeenCalledTimes(2);
    });

    it('does not retry an ordinary anonymous connection', async () => {
        // No cookie resolves to null without throwing. Retrying it would double
        // the auth-tier load for the most common connection on a public site.
        facade.getSessionFromHeaders.mockResolvedValueOnce(null);

        await expect(resolve()).resolves.toBeNull();
        expect(facade.getSessionFromHeaders).toHaveBeenCalledTimes(1);
    });
});
