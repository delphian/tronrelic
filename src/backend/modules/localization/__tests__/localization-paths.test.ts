/**
 * @fileoverview Tests for the shared path helpers in `@/types` that the Next.js
 * middleware and the backend both rely on. If these disagree with what an
 * administrator expects, a route shows as published on the admin page while
 * visitors get a 404, so the edge cases are pinned here.
 */

import { describe, it, expect } from 'vitest';
import type { ILocalizationPublicConfig } from '@/types';
import {
    findPublishedLanguages,
    interpolateTranslation,
    isValidRoutePattern,
    localizePath,
    matchRoutePattern,
    resolveLocalizedPath
} from '@/types';
import { isInternalServiceRequest } from '../api/isInternalServiceRequest.js';

/** A snapshot with Chinese live on two routes and Russian live on one. */
const CONFIG: ILocalizationPublicConfig = {
    defaultLanguage: 'en',
    languages: [
        { code: 'ru', name: 'Russian', nativeName: 'Русский', direction: 'ltr' },
        { code: 'zh', name: 'Chinese', nativeName: '中文', direction: 'ltr' }
    ],
    routes: [
        { pattern: '/', languages: ['zh'] },
        { pattern: '/markets', languages: ['zh', 'ru'] },
        { pattern: '/blog/*', languages: ['zh'] }
    ]
};

describe('matchRoutePattern', () => {
    it('matches literal paths exactly, ignoring a trailing slash', () => {
        expect(matchRoutePattern('/markets', '/markets')).toBe(true);
        expect(matchRoutePattern('/markets', '/markets/')).toBe(true);
        expect(matchRoutePattern('/markets', '/markets/btc')).toBe(false);
        expect(matchRoutePattern('/', '/')).toBe(true);
        expect(matchRoutePattern('/', '/markets')).toBe(false);
    });

    it('matches one segment for :name and one or more for a final *', () => {
        expect(matchRoutePattern('/address/:address', '/address/T123')).toBe(true);
        expect(matchRoutePattern('/address/:address', '/address')).toBe(false);
        expect(matchRoutePattern('/address/:address', '/address/T123/tx')).toBe(false);
        expect(matchRoutePattern('/blog/*', '/blog/post')).toBe(true);
        expect(matchRoutePattern('/blog/*', '/blog/2026/post')).toBe(true);
        // The index page is usually different text, so it is published separately.
        expect(matchRoutePattern('/blog/*', '/blog')).toBe(false);
    });
});

describe('isValidRoutePattern', () => {
    it('accepts the documented syntax and refuses anything that could never match', () => {
        for (const pattern of ['/', '/markets', '/blog/*', '/address/:address', '/tools/energy-estimator']) {
            expect(isValidRoutePattern(pattern)).toBe(true);
        }
        for (const pattern of ['markets', '/a//b', '/blog/*/more', '/a?b=1', '/a#x', '/a b', '/:bad-name']) {
            expect(isValidRoutePattern(pattern)).toBe(false);
        }
    });
});

describe('localizePath', () => {
    it('leaves English paths alone and prefixes every other language', () => {
        expect(localizePath('/markets', 'en')).toBe('/markets');
        expect(localizePath('/markets', 'zh')).toBe('/zh/markets');
        expect(localizePath('/', 'zh')).toBe('/zh');
    });
});

describe('findPublishedLanguages', () => {
    it('lists live languages in snapshot order', () => {
        expect(findPublishedLanguages(CONFIG, '/markets')).toEqual(['ru', 'zh']);
        expect(findPublishedLanguages(CONFIG, '/blog/post')).toEqual(['zh']);
        expect(findPublishedLanguages(CONFIG, '/about')).toEqual([]);
    });
});

describe('resolveLocalizedPath', () => {
    it('treats a prefix as a language only when the page is live in it', () => {
        expect(resolveLocalizedPath('/zh/markets', CONFIG)).toEqual({ language: 'zh', path: '/markets' });
        expect(resolveLocalizedPath('/zh', CONFIG)).toEqual({ language: 'zh', path: '/' });
        expect(resolveLocalizedPath('/ru/markets', CONFIG)).toEqual({ language: 'ru', path: '/markets' });
    });

    it('falls back to an English path for unpublished routes and unknown prefixes', () => {
        // Published in zh but not ru: the whole path is an English path, which 404s.
        expect(resolveLocalizedPath('/ru/blog/post', CONFIG)).toEqual({ language: 'en', path: '/ru/blog/post' });
        // Not a configured language: a page that lives at /id/... keeps working.
        expect(resolveLocalizedPath('/id/verify', CONFIG)).toEqual({ language: 'en', path: '/id/verify' });
        // English is never prefixed.
        expect(resolveLocalizedPath('/en/markets', CONFIG)).toEqual({ language: 'en', path: '/en/markets' });
        expect(resolveLocalizedPath('/markets', CONFIG)).toEqual({ language: 'en', path: '/markets' });
    });

    it('resolves everything to English when no language is enabled', () => {
        const empty: ILocalizationPublicConfig = { defaultLanguage: 'en', languages: [], routes: [] };
        expect(resolveLocalizedPath('/zh/markets', empty)).toEqual({ language: 'en', path: '/zh/markets' });
    });
});

describe('interpolateTranslation', () => {
    it('fills known placeholders and leaves unknown ones visible', () => {
        expect(interpolateTranslation('{count} rentals by {name}', { count: 3, name: 'Ann' })).toBe('3 rentals by Ann');
        expect(interpolateTranslation('{count} rentals by {name}', { count: 3 })).toBe('3 rentals by {name}');
        expect(interpolateTranslation('No placeholders')).toBe('No placeholders');
    });
});

describe('isInternalServiceRequest', () => {
    /**
     * Build the slice of an Express request the check reads.
     *
     * @param remoteAddress - Socket peer address.
     * @param headers - Request headers.
     * @returns A request stand-in.
     */
    function request(remoteAddress: string, headers: Record<string, string> = {}): any {
        return { headers, socket: { remoteAddress } };
    }

    it('accepts a direct call from a private container address', () => {
        expect(isInternalServiceRequest(request('172.18.0.5'))).toBe(true);
        expect(isInternalServiceRequest(request('::ffff:10.0.0.3'))).toBe(true);
        expect(isInternalServiceRequest(request('127.0.0.1'))).toBe(true);
    });

    it('refuses anything that came through a proxy or from a public address', () => {
        expect(isInternalServiceRequest(request('172.18.0.5', { 'x-forwarded-for': '203.0.113.9' }))).toBe(false);
        expect(isInternalServiceRequest(request('172.18.0.5', { 'cf-connecting-ip': '203.0.113.9' }))).toBe(false);
        expect(isInternalServiceRequest(request('203.0.113.9'))).toBe(false);
        expect(isInternalServiceRequest(request('172.32.0.1'))).toBe(false);
    });
});
