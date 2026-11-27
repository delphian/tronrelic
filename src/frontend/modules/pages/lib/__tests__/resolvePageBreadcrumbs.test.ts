/// <reference types="vitest" />

/**
 * Breadcrumb trail tests for CMS pages.
 *
 * The trail guards against two failures search engines punish: a crumb that
 * links an address answering 404, such as `/p` above `/p/mcp`, and a crumb
 * on a translated page that links a translated address nobody published.
 */

import { describe, it, expect, vi } from 'vitest';
import type { ILocalizationPublicConfig } from '@/types';
import type { ILocalizationSeed } from '../../../localization/types';
import type { IMenuCategory } from '../../../menu/server';

vi.mock('../../../localization/server', () => ({
    fetchLocalizationSeed: vi.fn()
}));

vi.mock('../../../localization/lib/observationReporter', () => ({
    reportTranslationObservation: vi.fn()
}));

import { resolvePageBreadcrumbs } from '../resolvePageBreadcrumbs';
import type { IPageBreadcrumbDependencies } from '../resolvePageBreadcrumbs';

const SITE_URL = 'https://tronrelic.com';

/** Chinese is live, with the home page and `/tools` published in it but not `/articles`. */
const CONFIG: ILocalizationPublicConfig = {
    defaultLanguage: 'en',
    languages: [{ code: 'zh', name: 'Chinese', nativeName: '中文', direction: 'ltr' }],
    routes: [
        { pattern: '/', languages: ['zh'] },
        { pattern: '/tools', languages: ['zh'] },
        { pattern: '/tools/*', languages: ['zh'] }
    ]
};

/**
 * Build the seed a language renders with, holding the translations the tests rely on.
 *
 * @param language - The language being rendered.
 */
function seedFor(language: string): ILocalizationSeed {
    const catalog: ILocalizationSeed['catalog'] = language === 'zh'
        ? { core: { 'breadcrumbs.home': '首页', 'menu.main.url::tools': '工具' } }
        : {};
    return { language, direction: 'ltr', path: '/', config: CONFIG, catalog };
}

/**
 * Build a category answer for a container node.
 *
 * @param url - The category's URL.
 * @param label - The category's English label.
 */
function category(url: string, label: string): IMenuCategory {
    return { success: true, node: { label, url }, children: [] };
}

/**
 * Build lookups where only the listed paths are menu categories.
 *
 * @param categories - Category answers keyed by URL.
 */
function dependencies(categories: Record<string, IMenuCategory>): IPageBreadcrumbDependencies {
    return {
        fetchSeed: async (language) => seedFor(language),
        fetchCategory: async (url) => categories[url] ?? null
    };
}

describe('resolvePageBreadcrumbs', () => {
    it('runs from home through a category parent to the page', async () => {
        const trail = await resolvePageBreadcrumbs(
            { slug: '/tools/whales', title: 'TRX Whale Tracker' },
            'en',
            SITE_URL,
            dependencies({ '/tools': category('/tools', 'Tools') })
        );

        expect(trail).toEqual([
            { name: 'Home', url: 'https://tronrelic.com' },
            { name: 'Tools', url: 'https://tronrelic.com/tools' },
            { name: 'TRX Whale Tracker', url: 'https://tronrelic.com/tools/whales' }
        ]);
    });

    it('leaves out a parent that is not a category, so no crumb links a 404', async () => {
        const trail = await resolvePageBreadcrumbs(
            { slug: '/p/mcp', title: 'Connect an AI Assistant' },
            'en',
            SITE_URL,
            dependencies({})
        );

        expect(trail.map(item => item.url)).toEqual([
            'https://tronrelic.com',
            'https://tronrelic.com/p/mcp'
        ]);
    });

    it('translates names and links translated addresses only where they are published', async () => {
        const trail = await resolvePageBreadcrumbs(
            { slug: '/tools/whales', title: 'TRX 巨鲸追踪器' },
            'zh',
            SITE_URL,
            dependencies({ '/tools': category('/tools', 'Tools') })
        );

        expect(trail).toEqual([
            { name: '首页', url: 'https://tronrelic.com/zh' },
            { name: '工具', url: 'https://tronrelic.com/zh/tools' },
            { name: 'TRX 巨鲸追踪器', url: 'https://tronrelic.com/zh/tools/whales' }
        ]);
    });

    it('falls back to the English address for a parent not published in the language', async () => {
        const trail = await resolvePageBreadcrumbs(
            { slug: '/articles/tron-trc10-token', title: 'TRC10' },
            'zh',
            SITE_URL,
            dependencies({ '/articles': category('/articles', 'Articles') })
        );

        expect(trail[1]).toEqual({ name: 'Articles', url: 'https://tronrelic.com/articles' });
    });

    it('returns an empty trail when the page metadata could not be read', async () => {
        const trail = await resolvePageBreadcrumbs(null, 'en', SITE_URL, dependencies({}));

        expect(trail).toEqual([]);
    });
});
