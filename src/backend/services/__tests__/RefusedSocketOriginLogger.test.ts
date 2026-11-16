/**
 * @file RefusedSocketOriginLogger.test.ts
 *
 * Covers the log entry written when the origin check refuses a WebSocket
 * handshake. The entry is the only record that another website tried to open
 * a socket, and the caller controls both the Origin header and how often the
 * handshake is retried, so the tests pin three things: which events produce
 * an entry, that repeats and floods are bounded, and that the logged value is
 * cut to a fixed length.
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import type { ISystemLogService } from '@/types';
import { WindowedLogLimiter } from '../../lib/WindowedLogLimiter.js';
import { MAX_LOGGED_ORIGIN_LENGTH, RefusedSocketOriginLogger, type IEngineConnectionError } from '../RefusedSocketOriginLogger.js';

/** The one origin the fake origin rule allows. */
const SITE_ORIGIN = 'https://tronrelic.example';

/**
 * Build the event engine.io emits for a refused handshake.
 *
 * @param origin - The Origin header on the refused request, or undefined when it sent none.
 * @param contextName - The reason engine.io gave; a refused origin arrives as
 *   `MIDDLEWARE_FAILURE`. Null builds an event with no reason at all.
 * @returns The event, shaped like the slice the logger reads.
 */
function refusal(origin: string | undefined, contextName: string | null = 'MIDDLEWARE_FAILURE'): IEngineConnectionError {
    return {
        req: { headers: origin === undefined ? {} : { origin } },
        context: contextName === null ? undefined : { name: contextName }
    };
}

describe('RefusedSocketOriginLogger', () => {
    let warn: Mock<ISystemLogService['warn']>;
    let nowMs: number;
    let refusedOrigins: RefusedSocketOriginLogger;

    beforeEach(() => {
        warn = vi.fn<ISystemLogService['warn']>();
        nowMs = 1_000_000;
        refusedOrigins = new RefusedSocketOriginLogger(
            { warn },
            new WindowedLogLimiter({ windowMs: 60 * 60 * 1000, maxKeys: 2, maxKeyLength: MAX_LOGGED_ORIGIN_LENGTH }, () => nowMs),
            origin => origin === SITE_ORIGIN
        );
    });

    it('logs the origin of a handshake the origin check refused', () => {
        refusedOrigins.record(refusal('https://copy.example'));

        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(
            { origin: 'https://copy.example', repeatsNotLoggedForMinutes: 60 },
            'WebSocket handshake refused: the origin is not allowed'
        );
    });

    it.each([
        ['an unknown session id', refusal('https://copy.example', 'UNKNOWN_SID')],
        ['a refusal with no reason given', refusal('https://copy.example', null)],
        ['a middleware failure from the site itself', refusal(SITE_ORIGIN)],
        ['a middleware failure with no Origin header', refusal(undefined)]
    ])('writes nothing for %s', (_label, event) => {
        refusedOrigins.record(event);

        expect(warn).not.toHaveBeenCalled();
    });

    it('logs a retrying origin once per window, then again in the next window', () => {
        refusedOrigins.record(refusal('https://copy.example'));
        refusedOrigins.record(refusal('https://copy.example'));
        refusedOrigins.record(refusal('https://copy.example'));
        expect(warn).toHaveBeenCalledTimes(1);

        nowMs += 60 * 60 * 1000;
        refusedOrigins.record(refusal('https://copy.example'));
        expect(warn).toHaveBeenCalledTimes(2);
    });

    it('reports once that the limit on distinct origins was reached, then stays quiet', () => {
        refusedOrigins.record(refusal('https://one.example'));
        refusedOrigins.record(refusal('https://two.example'));
        refusedOrigins.record(refusal('https://three.example'));
        refusedOrigins.record(refusal('https://four.example'));

        expect(warn).toHaveBeenCalledTimes(3);
        expect(warn).toHaveBeenLastCalledWith(
            { loggedOrigins: 2, windowMinutes: 60 },
            'Refused WebSocket origins are no longer being logged this window: the limit on distinct origins was reached'
        );
    });

    it('cuts an oversized Origin header before logging it', () => {
        refusedOrigins.record(refusal(`https://${'a'.repeat(5000)}.example`));

        const logged = warn.mock.calls[0][0] as { origin: string };
        expect(logged.origin).toHaveLength(MAX_LOGGED_ORIGIN_LENGTH);
    });
});
