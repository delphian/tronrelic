/**
 * @fileoverview Tests for the frontend localization helpers whose output
 * search engines and visitors see directly: the translator, the hreflang list,
 * and the localized canonical URL.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ILocalizationPublicConfig } from '@/types';

vi.mock('../observationReporter', () => ({
    reportTranslationObservation: vi.fn()
}));

import { reportTranslationObservation } from '../observationReporter';
import { createTranslator } from '../createTranslator';
import { buildLanguageAlternates } from '../buildLanguageAlternates';
import { localizedAbsoluteUrl } from '../../../../lib/seo';
import type { ILocalizationSeed } from '../../types';

const SITE = 'https://tronrelic.com';

/** Chinese live on /markets only. */
const CONFIG: ILocalizationPublicConfig = {
    defaultLanguage: 'en',
    languages: [{ code: 'zh', name: 'Chinese', nativeName: '中文', direction: 'ltr' }],
    routes: [{ pattern: '/markets', languages: ['zh'] }]
};

/**
 * Build a seed for a page in one language.
 *
 * @param language - Page language.
 * @param catalog - Translations by namespace and key.
 * @returns The seed.
 */
function seed(language: string, catalog: ILocalizationSeed['catalog']): ILocalizationSeed {
    return { language, direction: 'ltr', path: '/markets', config: CONFIG, catalog };
}

describe('createTranslator', () => {
    beforeEach(() => {
        vi.mocked(reportTranslationObservation).mockClear();
    });

    it('returns the English text unchanged on an English page', () => {
        const { t } = createTranslator(seed('en', {}), 'core');
        expect(t('title', 'Energy Markets')).toBe('Energy Markets');
        expect(reportTranslationObservation).toHaveBeenCalledWith({
            namespace: 'core', key: 'title', source: 'Energy Markets', path: '/markets'
        });
    });

    it('returns the translation for its own namespace only, with placeholders filled', () => {
        const page = seed('zh', { 'trp-markets': { count: '{count} 个市场' } });
        expect(createTranslator(page, 'trp-markets').t('count', '{count} markets', { count: 4 })).toBe('4 个市场');
        expect(createTranslator(page, 'core').t('count', '{count} markets', { count: 4 })).toBe('4 markets');
    });

    it('reports a translated page that fell back to English as missing', () => {
        createTranslator(seed('zh', {}), 'core').t('title', 'Energy Markets');
        expect(reportTranslationObservation).toHaveBeenCalledWith(expect.objectContaining({ key: 'title', missingIn: 'zh' }));
    });
});

describe('buildLanguageAlternates', () => {
    it('lists every version plus x-default for a published page', () => {
        expect(buildLanguageAlternates(CONFIG, '/markets', SITE)).toEqual([
            { hrefLang: 'en', href: `${SITE}/markets` },
            { hrefLang: 'zh', href: `${SITE}/zh/markets` },
            { hrefLang: 'x-default', href: `${SITE}/markets` }
        ]);
    });

    it('emits nothing for an English-only page, so its head is unchanged', () => {
        expect(buildLanguageAlternates(CONFIG, '/about', SITE)).toEqual([]);
    });
});

describe('localizedAbsoluteUrl', () => {
    it('leaves English URLs exactly as before', () => {
        expect(localizedAbsoluteUrl(SITE, '/markets')).toBe(`${SITE}/markets`);
        expect(localizedAbsoluteUrl(SITE, '/markets', 'en')).toBe(`${SITE}/markets`);
    });

    it('prefixes same-site paths and URLs for a translated page', () => {
        expect(localizedAbsoluteUrl(SITE, '/markets', 'zh')).toBe(`${SITE}/zh/markets`);
        expect(localizedAbsoluteUrl(SITE, '/', 'zh')).toBe(`${SITE}/zh`);
        expect(localizedAbsoluteUrl(SITE, `${SITE}/blog/post?page=2`, 'zh')).toBe(`${SITE}/zh/blog/post?page=2`);
    });

    it('leaves other hosts alone', () => {
        expect(localizedAbsoluteUrl(SITE, 'https://example.com/x', 'zh')).toBe('https://example.com/x');
        expect(localizedAbsoluteUrl(SITE, 'https://tronrelic.com.evil.test/x', 'zh')).toBe('https://tronrelic.com.evil.test/x');
    });
});
