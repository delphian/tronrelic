/// <reference types="vitest" />

/**
 * @fileoverview Tests for CMS page translations through the core content
 * translation service: the per-page opt-in, the public render that never falls
 * back to English, the stale flag, the curator-only rule, and the routes handed
 * to the localization snapshot.
 *
 * Runs the real core content service and page service against the mock
 * database, so permissions and visibility follow the production rules rather
 * than a hand-written stand-in.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PageService } from '../services/page.service.js';
import { PageTranslationService } from '../services/page-translation.service.js';
import type { ICacheService, IContentActor, IContentTranslationService, ICurationService, TranslationValues } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { ContentService } from '../../../services/content-service.js';
import { HookRegistry } from '../../../hooks/hook-registry.js';

/**
 * In-memory cache so render caching runs without Redis. Tag invalidation
 * drops every entry, which is enough to keep one test's render out of the next
 * assertion.
 */
class MockCacheService implements ICacheService {
    private cache = new Map<string, unknown>();

    /**
     * @param key - Cache key.
     * @returns The stored value, or null.
     */
    async get<T = unknown>(key: string): Promise<T | null> {
        return (this.cache.get(key) as T | undefined) ?? null;
    }

    /**
     * @param key - Cache key.
     * @param value - Value to keep.
     */
    async set<T = unknown>(key: string, value: T): Promise<void> {
        this.cache.set(key, value);
    }

    /**
     * @param key - Cache key.
     * @returns How many entries were removed.
     */
    async del(key: string): Promise<number> {
        return this.cache.delete(key) ? 1 : 0;
    }

    /** Drop everything, standing in for tag invalidation. */
    async invalidate(): Promise<void> {
        this.cache.clear();
    }

    /** @returns Every key. */
    async keys(): Promise<string[]> {
        return [...this.cache.keys()];
    }
}

const mockLogger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child: () => mockLogger
};

/** A signed-in admin: a curator, the only actor who may change translations. */
const curator: IContentActor = { id: 'user-admin', kind: 'user', isCurator: true };

/** The shared service token: not a curator, so translation writes are refused. */
const serviceToken: IContentActor = { id: 'system:service-token', kind: 'system', isCurator: false };

/**
 * Build English page markdown with frontmatter.
 *
 * @param opts - The frontmatter fields and body to write.
 * @returns Markdown including the frontmatter block.
 */
function markdown(opts: { title: string; slug?: string; oldSlugs?: string[]; published?: boolean; ogImage?: string; body?: string }): string {
    const lines = ['---', `title: "${opts.title}"`];
    if (opts.slug) lines.push(`slug: "${opts.slug}"`);
    if (opts.oldSlugs) lines.push(`oldSlugs: ${JSON.stringify(opts.oldSlugs)}`);
    if (opts.published) lines.push('published: true');
    if (opts.ogImage) lines.push(`ogImage: "${opts.ogImage}"`);
    lines.push('---', '', opts.body ?? `# ${opts.title}`);
    return lines.join('\n');
}

/**
 * Build translated values for a page.
 *
 * @param title - Translated title.
 * @param body - Translated body.
 * @returns Values for every page translation field.
 */
function values(title: string, body = `# ${title}`): TranslationValues {
    return { title, description: '', keywords: [], body, ogImage: '' };
}

describe('page translations', () => {
    let pages: PageService;
    let rendering: PageTranslationService;
    let translations: IContentTranslationService;
    let onRoutesChanged: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(async () => {
        PageService.resetForTests();
        PageTranslationService.resetForTests();
        ContentService.resetForTests();
        const database = createMockDatabaseService();
        const cache = new MockCacheService();
        const curation = {
            registerType: vi.fn(),
            unregisterType: vi.fn(),
            hold: vi.fn(async () => ({ id: `item-${Math.random()}`, status: 'pending' })),
            approve: vi.fn(async () => null)
        };
        onRoutesChanged = vi.fn<() => void>();
        ContentService.setDependencies(
            database,
            new HookRegistry(mockLogger),
            createMockServiceRegistry({ curation: curation as unknown as ICurationService }),
            mockLogger,
            onRoutesChanged
        );
        const contentService = ContentService.getInstance();
        translations = contentService.translations();

        PageService.setDependencies(database, cache, contentService, mockLogger);
        pages = PageService.getInstance();
        await pages.ensureTranslationIndexes();
        PageTranslationService.setDependencies({ cacheService: cache, contentService, pages });
        rendering = PageTranslationService.getInstance();
        contentService.registerType(pages.getContentType(), 'pages');
    });

    /**
     * Create a published English page as a curator.
     *
     * @param slug - Slug of the page.
     * @param extra - Further frontmatter.
     * @returns The page's core content id.
     */
    async function createPage(slug: string, extra: { oldSlugs?: string[]; ogImage?: string } = {}): Promise<string> {
        const page = await pages.createPage(markdown({ title: 'About', slug, published: true, ...extra }), curator);
        return page.contentId as string;
    }

    describe('per-page opt-in', () => {
        it('lists no localized routes for a page without translations', async () => {
            await createPage('/about');
            expect(await translations.listLocalizedRoutes()).toEqual([]);
        });

        it('lists the page slug and its old slugs once a published translation exists', async () => {
            const pageId = await createPage('/about', { oldSlugs: ['/company'] });
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: true }, curator);

            expect(await translations.listLocalizedRoutes()).toEqual([
                { pattern: '/about', languages: ['zh'] },
                { pattern: '/company', languages: ['zh'] }
            ]);
            expect(onRoutesChanged).toHaveBeenCalled();
        });

        it('does not list a draft translation', async () => {
            const pageId = await createPage('/about');
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: false }, curator);

            expect(await translations.listLocalizedRoutes()).toEqual([]);
        });

        it('stops listing a translation once it is deleted, and lists it again once restored', async () => {
            const pageId = await createPage('/about');
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: true }, curator);
            await translations.deleteTranslation('core:page', pageId, 'zh', curator);
            expect(await translations.listLocalizedRoutes()).toEqual([]);

            await translations.restoreTranslation('core:page', pageId, 'zh', curator);
            expect(await translations.listLocalizedRoutes()).toEqual([{ pattern: '/about', languages: ['zh'] }]);
        });

        it('leaves out an old slug that would act as a route pattern', async () => {
            const pageId = await createPage('/about', { oldSlugs: ['/blog/*'] });
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: true }, curator);

            expect(await translations.listLocalizedRoutes()).toEqual([{ pattern: '/about', languages: ['zh'] }]);
        });
    });

    describe('renderPublicTranslation', () => {
        it('renders the translated body and metadata, falling back to the English image', async () => {
            const pageId = await createPage('/about', { ogImage: '/uploads/en.png' });
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于', '你好'), published: true }, curator);

            const render = await rendering.renderPublicTranslation('/about', 'zh');
            expect(render?.html).toContain('你好');
            expect(render?.metadata.title).toBe('关于');
            expect(render?.metadata.ogImage).toBe('/uploads/en.png');
        });

        it('returns null rather than the English body when no translation exists', async () => {
            await createPage('/about');
            expect(await rendering.renderPublicTranslation('/about', 'zh')).toBeNull();
        });

        it('returns null for a draft translation', async () => {
            const pageId = await createPage('/about');
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: false }, curator);

            expect(await rendering.renderPublicTranslation('/about', 'zh')).toBeNull();
        });

        it('returns null for a malformed language code', async () => {
            await createPage('/about');
            expect(await rendering.renderPublicTranslation('/about', '../x')).toBeNull();
        });
    });

    describe('writes', () => {
        it('refuses a translation write from anyone but a curator', async () => {
            const pageId = await createPage('/about');
            await expect(
                translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: true }, serviceToken)
            ).rejects.toMatchObject({ code: 'forbidden' });
        });

        it('refuses a translation into the default language', async () => {
            const pageId = await createPage('/about');
            await expect(
                translations.saveTranslation('core:page', pageId, 'en', { values: values('About'), published: true }, curator)
            ).rejects.toThrow(/another language/);
        });

        it('refuses a translation missing a required field', async () => {
            const pageId = await createPage('/about');
            await expect(
                translations.saveTranslation('core:page', pageId, 'zh', { values: { title: '关于' }, published: true }, curator)
            ).rejects.toThrow(/Body is required/);
        });

        it('replaces an existing translation on a second save instead of adding another', async () => {
            const pageId = await createPage('/about');
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: false }, curator);
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于我们'), published: true }, curator);

            const overview = await translations.getOverview('core:page', pageId);
            expect(overview.translations).toHaveLength(1);
            expect(overview.translations[0].values.title).toBe('关于我们');
            expect(overview.translations[0].published).toBe(true);
        });

        it('refuses to change a deleted translation until it is restored', async () => {
            const pageId = await createPage('/about');
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: true }, curator);
            await translations.deleteTranslation('core:page', pageId, 'zh', curator);

            await expect(
                translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: true }, curator)
            ).rejects.toMatchObject({ code: 'deleted' });
        });
    });

    describe('stale flag and English source', () => {
        it('flags a translation stale after the English page changes, and clears it on save', async () => {
            const pageId = await createPage('/about');
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: true }, curator);
            expect((await translations.getOverview('core:page', pageId)).translations[0].stale).toBe(false);

            await pages.updatePage(pageId, markdown({ title: 'About us', slug: '/about', published: true }), curator);
            expect((await translations.getOverview('core:page', pageId)).translations[0].stale).toBe(true);

            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于我们'), published: true }, curator);
            expect((await translations.getOverview('core:page', pageId)).translations[0].stale).toBe(false);
        });

        it('does not flag a translation stale when only the English slug changes', async () => {
            const pageId = await createPage('/about');
            await translations.saveTranslation('core:page', pageId, 'zh', { values: values('关于'), published: true }, curator);
            await pages.updatePage(pageId, markdown({ title: 'About', slug: '/about-us', published: true }), curator);

            expect((await translations.getOverview('core:page', pageId)).translations[0].stale).toBe(false);
        });

        it('shows the served English text while an edit waits for review, and flags the pending edit', async () => {
            const pageId = await createPage('/about');
            await pages.updatePage(pageId, markdown({ title: 'About us', slug: '/about', published: true }), serviceToken);

            const { source } = await translations.getOverview('core:page', pageId);
            expect(source.values.title).toBe('About');
            expect(source.values.body).toContain('# About');
            expect(source.values.body).not.toContain('title:');
            expect(source.pendingEdit).toBe(true);
        });

        it('does not flag a pending edit that changes only the slug', async () => {
            const pageId = await createPage('/about');
            await pages.updatePage(pageId, markdown({ title: 'About', slug: '/about-us', published: true }), serviceToken);

            expect((await translations.getOverview('core:page', pageId)).source.pendingEdit).toBe(false);
        });
    });
});
