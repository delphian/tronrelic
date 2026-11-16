/**
 * @file auth-cookie-options.test.ts
 *
 * Pins the SameSite attribute of the cookies Better Auth sets. The origin
 * check lets a request with no Origin header through, so `SameSite=Lax` is
 * what keeps the session cookie off requests another website triggers. The
 * tests ask Better Auth what the options resolve to, instead of reading the
 * options back, so they also fail if a library upgrade stops honouring them.
 */

import { describe, it, expect } from 'vitest';
import { getCookies } from 'better-auth/cookies';
import { buildAuthCookieOptions } from '../services/buildAuthCookieOptions.js';

describe('buildAuthCookieOptions', () => {
    it.each([
        'sessionToken',
        'sessionData',
        'accountData',
        'dontRememberToken'
    ] as const)('makes Better Auth resolve the %s cookie as SameSite=Lax', (cookie) => {
        const cookies = getCookies({ baseURL: 'https://tronrelic.example', advanced: buildAuthCookieOptions() });

        expect(cookies[cookie].attributes.sameSite).toBe('lax');
    });

    it('leaves the other session cookie attributes at their secure values', () => {
        const { attributes } = getCookies({ baseURL: 'https://tronrelic.example', advanced: buildAuthCookieOptions() }).sessionToken;

        expect(attributes).toMatchObject({ httpOnly: true, secure: true, path: '/' });
    });
});
