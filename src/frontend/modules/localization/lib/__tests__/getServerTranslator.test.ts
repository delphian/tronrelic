/**
 * @fileoverview Tests for the server-side seed loader and translator.
 *
 * These decide which language a page's metadata is written in. A mistake here
 * sends search engines an English title on a translated page, or a translated
 * title on a request the middleware never routed, so the routing and fallback
 * cases are covered directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ILocalizationPublicConfig } from '@/types';

vi.mock('../observationReporter', () => ({
    reportTranslationObservation: vi.fn()
}));

vi.mock('../resolveRequestLanguage', () => ({
    resolveRequestLanguage: vi.fn()
}));

vi.mock('../fetchLocalization', () => ({
    fetchLocalizationConfig: vi.fn(),
    fetchTranslationCatalog: vi.fn()
}));

import { resolveRequestLanguage } from '../resolveRequestLanguage';
import { fetchLocalizationConfig, fetchTranslationCatalog } from '../fetchLocalization';
import { fetchLocalizationSeed } from '../fetchLocalizationSeed';
import { getServerTranslator } from '../getServerTranslator';

/** Chinese translations for the core namespace; every other language has none. */
const ZH_CATALOG: Record<string, Record<string, string>> = { core: { 'about.title': '关于 TronRelic' } };

/** Chinese and Arabic live; Arabic is right to left. */
const CONFIG: ILocalizationPublicConfig = {
    defaultLanguage: 'en',
    languages: [
        { code: 'zh', name: 'Chinese', nativeName: '简体中文', direction: 'ltr' },
        { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'rtl' }
    ],
    routes: [{ pattern: '/about', languages: ['zh', 'ar'] }]
};

/**
 * Point the mocked request at one routed language and path.
 *
 * @param language - The language the middleware routed to.
 * @param path - The unprefixed request path.
 */
function routeTo(language: string, path = '/about'): void {
    vi.mocked(resolveRequestLanguage).mockResolvedValue({ language, routed: true, path });
}

describe('fetchLocalizationSeed', () => {
    beforeEach(() => {
        vi.mocked(fetchLocalizationConfig).mockResolvedValue(CONFIG);
        vi.mocked(fetchTranslationCatalog).mockResolvedValue({});
    });

    it('takes the direction of the routed language from the snapshot', async () => {
        routeTo('ar');
        const seed = await fetchLocalizationSeed('ar');
        expect(seed.language).toBe('ar');
        expect(seed.direction).toBe('rtl');
        expect(seed.path).toBe('/about');
        expect(fetchTranslationCatalog).toHaveBeenCalledWith('ar');
    });

    it('falls back to left to right for English, which is not in the snapshot', async () => {
        routeTo('en');
        const seed = await fetchLocalizationSeed('en');
        expect(seed.direction).toBe('ltr');
        expect(seed.config).toBe(CONFIG);
    });
});

describe('getServerTranslator', () => {
    beforeEach(() => {
        vi.mocked(fetchLocalizationConfig).mockResolvedValue(CONFIG);
        vi.mocked(fetchTranslationCatalog).mockImplementation(async language => (language === 'zh' ? ZH_CATALOG : {}));
    });

    it('translates core keys for a routed translated page', async () => {
        routeTo('zh');
        const { t, language } = await getServerTranslator(Promise.resolve({ lang: 'zh' }));
        expect(language).toBe('zh');
        expect(t('about.title', 'About TronRelic')).toBe('关于 TronRelic');
    });

    it('returns the English text on an English page', async () => {
        routeTo('en');
        const { t, language } = await getServerTranslator(Promise.resolve({ lang: 'en' }));
        expect(language).toBe('en');
        expect(t('about.title', 'About TronRelic')).toBe('About TronRelic');
    });

    it('looks keys up in the namespace it was given', async () => {
        routeTo('zh');
        const { t } = await getServerTranslator(Promise.resolve({ lang: 'zh' }), 'trp-blog');
        expect(t('about.title', 'About TronRelic')).toBe('About TronRelic');
    });
});
