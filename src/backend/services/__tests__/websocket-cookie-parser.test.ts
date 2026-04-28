/// <reference types="vitest" />

import { describe, it, expect } from 'vitest';
import { sign } from 'cookie-signature';
import { parseUserIdFromCookieHeader } from '../websocket.service.js';
import { env } from '../../config/env.js';

const VALID = '550e8400-e29b-41d4-a716-446655440000';
const SECRET = env.SESSION_SECRET ?? '';

/** Build the on-the-wire form of a signed cookie value: `s:<value>.<HMAC>`. */
function signedCookieValue(uuid: string, secret: string = SECRET): string {
    return `s:${sign(uuid, secret)}`;
}

describe('parseUserIdFromCookieHeader', () => {
    it('extracts the identity UUID from a signed cookie header', () => {
        const value = encodeURIComponent(signedCookieValue(VALID));
        expect(parseUserIdFromCookieHeader(`tronrelic_uid=${value}`)).toBe(VALID);
    });

    it('extracts the identity UUID when signed cookie sits beside other cookies', () => {
        const value = encodeURIComponent(signedCookieValue(VALID));
        expect(
            parseUserIdFromCookieHeader(`session=abc; tronrelic_uid=${value}; theme=dark`)
        ).toBe(VALID);
    });

    it('rejects a signed cookie when the HMAC is forged', () => {
        // Construct a value with the wrong secret, then submit it with the
        // right name. This simulates a non-browser client setting a cookie
        // it computed locally without server SESSION_SECRET.
        const forged = encodeURIComponent(signedCookieValue(VALID, 'wrong-secret'));
        expect(parseUserIdFromCookieHeader(`tronrelic_uid=${forged}`)).toBeNull();
    });

    it('rejects a signed cookie when the inner value is not a UUID v4', () => {
        const value = encodeURIComponent(signedCookieValue('not-a-uuid'));
        expect(parseUserIdFromCookieHeader(`tronrelic_uid=${value}`)).toBeNull();
    });

    it('rejects an unsigned cookie even when the value is a valid UUID', () => {
        // The websocket handshake has no Set-Cookie channel, so it cannot
        // re-anchor a legacy cookie the way HTTP entry points do. Accepting
        // unsigned identity here would let any client that learned a
        // victim's UUID forge a Cookie header and subscribe to that user's
        // identity room without possessing SESSION_SECRET — the exact
        // attack signing was meant to close. Browser visitors always reach
        // the WS handshake with a signed cookie because SocketBridge
        // defers the connection past hydration, by which point bootstrap
        // has re-anchored.
        expect(parseUserIdFromCookieHeader(`tronrelic_uid=${VALID}`)).toBeNull();
    });

    it('rejects a URL-encoded unsigned cookie value', () => {
        const encoded = encodeURIComponent(VALID);
        expect(parseUserIdFromCookieHeader(`tronrelic_uid=${encoded}`)).toBeNull();
    });

    it('returns null when the cookie header is missing', () => {
        expect(parseUserIdFromCookieHeader(undefined)).toBeNull();
        expect(parseUserIdFromCookieHeader(null)).toBeNull();
        expect(parseUserIdFromCookieHeader('')).toBeNull();
    });

    it('returns null when the identity cookie is absent', () => {
        expect(parseUserIdFromCookieHeader('session=abc; theme=dark')).toBeNull();
    });

    it('returns null when the cookie value is malformed', () => {
        expect(parseUserIdFromCookieHeader('tronrelic_uid=not-a-uuid')).toBeNull();
        expect(parseUserIdFromCookieHeader('tronrelic_uid=550e8400-e29b-11d4-a716-446655440000')).toBeNull(); // v1
    });

    it('does not match a similarly-named cookie', () => {
        expect(parseUserIdFromCookieHeader(`other_tronrelic_uid=${VALID}`)).toBeNull();
    });
});
