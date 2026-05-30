/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the analytics/referral cookie helpers.
 *
 * Covers resolution (unsigned reads), validation (UUID for tid, code regex for
 * ref), and the cookie-set option shape (HttpOnly, unsigned, SameSite,
 * max-age). Express `req`/`res` are stubbed — only `cookies` and `res.cookie`
 * matter here.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
    TID_COOKIE_NAME,
    REF_COOKIE_NAME,
    TID_COOKIE_MAX_AGE_SECONDS,
    REF_COOKIE_MAX_AGE_SECONDS,
    resolveTid,
    resolveRef,
    normalizeReferralCode,
    setTidCookie,
    setRefCookie
} from '../api/traffic-cookies.js';

const VALID_TID = '550e8400-e29b-41d4-a716-446655440000';

function reqWithCookies(cookies: Record<string, unknown>): Request {
    return { cookies } as unknown as Request;
}

function stubRes(): { res: Response; calls: Array<{ name: string; value: string; options: any }> } {
    const calls: Array<{ name: string; value: string; options: any }> = [];
    const res = {
        cookie: vi.fn((name: string, value: string, options: any) => {
            calls.push({ name, value, options });
        })
    } as unknown as Response;
    return { res, calls };
}

describe('traffic-cookies', () => {
    describe('resolveTid', () => {
        it('returns a valid UUID v4 tid from the unsigned cookie bag', () => {
            expect(resolveTid(reqWithCookies({ [TID_COOKIE_NAME]: VALID_TID }))).toBe(VALID_TID);
        });

        it('returns null for a malformed tid', () => {
            expect(resolveTid(reqWithCookies({ [TID_COOKIE_NAME]: 'not-a-uuid' }))).toBeNull();
        });

        it('returns null when absent', () => {
            expect(resolveTid(reqWithCookies({}))).toBeNull();
        });
    });

    describe('normalizeReferralCode / resolveRef', () => {
        it('accepts a well-formed code', () => {
            expect(normalizeReferralCode('a1b2c3d4')).toBe('a1b2c3d4');
            expect(resolveRef(reqWithCookies({ [REF_COOKIE_NAME]: 'ref_code-9' }))).toBe('ref_code-9');
        });

        it('rejects codes that are too short, too long, or contain bad chars', () => {
            expect(normalizeReferralCode('abc')).toBeNull();
            expect(normalizeReferralCode('x'.repeat(33))).toBeNull();
            expect(normalizeReferralCode('has spaces')).toBeNull();
            expect(normalizeReferralCode('emoji😀code')).toBeNull();
        });

        it('rejects non-string input', () => {
            expect(normalizeReferralCode(undefined)).toBeNull();
            expect(normalizeReferralCode(42)).toBeNull();
        });
    });

    describe('setTidCookie', () => {
        it('writes an HttpOnly, unsigned, 1-year cookie', () => {
            const { res, calls } = stubRes();
            setTidCookie(res, VALID_TID, false);
            expect(calls).toHaveLength(1);
            expect(calls[0].name).toBe(TID_COOKIE_NAME);
            expect(calls[0].value).toBe(VALID_TID);
            expect(calls[0].options).toMatchObject({
                httpOnly: true,
                signed: false,
                sameSite: 'lax',
                secure: false,
                path: '/',
                maxAge: TID_COOKIE_MAX_AGE_SECONDS * 1000
            });
        });
    });

    describe('setRefCookie', () => {
        it('writes an HttpOnly, unsigned, 90-day cookie', () => {
            const { res, calls } = stubRes();
            setRefCookie(res, 'a1b2c3d4', false);
            expect(calls).toHaveLength(1);
            expect(calls[0].name).toBe(REF_COOKIE_NAME);
            expect(calls[0].options).toMatchObject({
                httpOnly: true,
                signed: false,
                maxAge: REF_COOKIE_MAX_AGE_SECONDS * 1000
            });
        });
    });
});
