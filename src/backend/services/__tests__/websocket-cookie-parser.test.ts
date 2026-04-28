/// <reference types="vitest" />

import { describe, it, expect } from 'vitest';
import { parseUserIdFromCookieHeader } from '../websocket.service.js';

const VALID = '550e8400-e29b-41d4-a716-446655440000';

describe('parseUserIdFromCookieHeader', () => {
    it('extracts the identity UUID from a single-cookie header', () => {
        expect(parseUserIdFromCookieHeader(`tronrelic_uid=${VALID}`)).toBe(VALID);
    });

    it('extracts the identity UUID when other cookies are present', () => {
        expect(parseUserIdFromCookieHeader(`session=abc; tronrelic_uid=${VALID}; theme=dark`)).toBe(VALID);
    });

    it('decodes URL-encoded cookie values', () => {
        const encoded = encodeURIComponent(VALID);
        expect(parseUserIdFromCookieHeader(`tronrelic_uid=${encoded}`)).toBe(VALID);
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
