/**
 * @fileoverview Tests for the shared consent rules in `@/types`: the region
 * check, the cookie format, and `resolveConsentState`.
 *
 * These helpers run in the Next.js middleware, the root layout, and the
 * backend alike, so a mistake here would show the wrong banner or set cookies
 * without consent everywhere at once. They are tested here because the
 * types package has no test runner of its own.
 */

import { describe, it, expect } from 'vitest';
import type { IConsentPublicConfig } from '@/types';
import {
    CONSENT_COOKIE_MAX_AGE_SECONDS,
    isConsentRequiredCountry,
    parseConsentCookie,
    resolveConsentState,
    serializeConsentCookie
} from '@/types';

/** A fixed moment, so cookie ages are deterministic. */
const NOW_MS = Date.UTC(2026, 9, 20, 12, 0, 0);
const NOW_SECONDS = Math.floor(NOW_MS / 1000);

/** Settings with the main switch on and policy version 3. */
const ENABLED: IConsentPublicConfig = { enabled: true, policyVersion: 3, googleAdsId: 'AW-123456789', conversionLabel: 'label' };

describe('isConsentRequiredCountry', () => {
    it('requires consent in the EU, the rest of the EEA, the UK, and Switzerland', () => {
        for (const code of ['DE', 'fr', 'IE', 'NO', 'IS', 'LI', 'GB', 'CH', 'RE']) {
            expect(isConsentRequiredCountry(code), code).toBe(true);
        }
    });

    it('does not require it elsewhere', () => {
        for (const code of ['US', 'SG', 'BR', 'JP']) {
            expect(isConsentRequiredCountry(code), code).toBe(false);
        }
    });

    it('treats an unknown country as requiring consent', () => {
        for (const code of [undefined, null, '', 'XX', 'T1', 'USA', '1']) {
            expect(isConsentRequiredCountry(code), String(code)).toBe(true);
        }
    });
});

describe('consent cookie format', () => {
    it('round-trips a choice', () => {
        const choice = { version: 3, analytics: true, ads: false, decidedAt: NOW_SECONDS };
        expect(serializeConsentCookie(choice)).toBe(`3.10.${NOW_SECONDS}`);
        expect(parseConsentCookie(serializeConsentCookie(choice))).toEqual(choice);
    });

    it('reads a damaged or foreign value as no choice', () => {
        for (const value of [undefined, '', 'yes', '3.1.1760000000', '3.12.1760000000', '3.11.abc', '3.11.1760000000;x']) {
            expect(parseConsentCookie(value), String(value)).toBeNull();
        }
    });
});

describe('resolveConsentState', () => {
    it('with the main switch off, keeps analytics on and advertising off for everyone', () => {
        const state = resolveConsentState({ ...ENABLED, enabled: false }, 'DE', undefined, NOW_MS);
        expect(state).toEqual({ enabled: false, required: false, decided: false, analytics: true, ads: false });
    });

    it('allows both outside the consent regions without asking', () => {
        expect(resolveConsentState(ENABLED, 'US', undefined, NOW_MS)).toEqual({
            enabled: true, required: false, decided: false, analytics: true, ads: true
        });
    });

    it('honours a choice a visitor outside the consent regions saved from "Privacy choices"', () => {
        const cookie = serializeConsentCookie({ version: 3, analytics: false, ads: false, decidedAt: NOW_SECONDS - 60 });
        expect(resolveConsentState(ENABLED, 'US', cookie, NOW_MS)).toEqual({
            enabled: true, required: false, decided: true, analytics: false, ads: false
        });
    });

    it('allows nothing in a consent region until the visitor answers', () => {
        expect(resolveConsentState(ENABLED, 'DE', undefined, NOW_MS)).toEqual({
            enabled: true, required: true, decided: false, analytics: false, ads: false
        });
    });

    it('applies a current choice', () => {
        const cookie = serializeConsentCookie({ version: 3, analytics: true, ads: false, decidedAt: NOW_SECONDS - 60 });
        expect(resolveConsentState(ENABLED, 'DE', cookie, NOW_MS)).toEqual({
            enabled: true, required: true, decided: true, analytics: true, ads: false
        });
    });

    it('ignores a choice made under an older policy version', () => {
        const cookie = serializeConsentCookie({ version: 2, analytics: true, ads: true, decidedAt: NOW_SECONDS - 60 });
        const state = resolveConsentState(ENABLED, 'DE', cookie, NOW_MS);
        expect(state.decided).toBe(false);
        expect(state.analytics).toBe(false);
        expect(state.ads).toBe(false);
    });

    it('ignores a choice older than twelve months, or dated in the future', () => {
        const stale = serializeConsentCookie({ version: 3, analytics: true, ads: true, decidedAt: NOW_SECONDS - CONSENT_COOKIE_MAX_AGE_SECONDS });
        const future = serializeConsentCookie({ version: 3, analytics: true, ads: true, decidedAt: NOW_SECONDS + 7 * 24 * 60 * 60 });
        expect(resolveConsentState(ENABLED, 'DE', stale, NOW_MS).decided).toBe(false);
        expect(resolveConsentState(ENABLED, 'DE', future, NOW_MS).decided).toBe(false);
    });

    it('asks a visitor outside the consent regions again when their refusal goes stale', () => {
        const renewed = serializeConsentCookie({ version: 2, analytics: false, ads: false, decidedAt: NOW_SECONDS - 60 });
        expect(resolveConsentState(ENABLED, 'US', renewed, NOW_MS)).toEqual({
            enabled: true, required: true, decided: false, analytics: false, ads: false
        });
        const aged = serializeConsentCookie({ version: 3, analytics: true, ads: false, decidedAt: NOW_SECONDS - CONSENT_COOKIE_MAX_AGE_SECONDS });
        expect(resolveConsentState(ENABLED, 'US', aged, NOW_MS)).toEqual({
            enabled: true, required: true, decided: false, analytics: false, ads: false
        });
    });

    it('returns a visitor outside the consent regions to the default when a stale choice allowed everything', () => {
        const cookie = serializeConsentCookie({ version: 2, analytics: true, ads: true, decidedAt: NOW_SECONDS - 60 });
        expect(resolveConsentState(ENABLED, 'US', cookie, NOW_MS)).toEqual({
            enabled: true, required: false, decided: false, analytics: true, ads: true
        });
    });

    it('does not count declined advertising as a refusal while no Ads id is configured', () => {
        const noAds: IConsentPublicConfig = { ...ENABLED, googleAdsId: null, conversionLabel: null };
        const cookie = serializeConsentCookie({ version: 2, analytics: true, ads: false, decidedAt: NOW_SECONDS - 60 });
        expect(resolveConsentState(noAds, 'US', cookie, NOW_MS)).toEqual({
            enabled: true, required: false, decided: false, analytics: true, ads: true
        });
    });
});
