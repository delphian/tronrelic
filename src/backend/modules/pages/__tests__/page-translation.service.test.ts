/// <reference types="vitest" />

/**
 * @fileoverview Tests for CMS page translations: the per-page opt-in, the
 * public render that never falls back to English, the stale flag, and the
 * routes handed to the localization snapshot.
 *
 * Runs the real core content service against the mock database, the same way
 * the page service tests do, so review and visibility follow the production
 * rules rather than a hand-written stand-in.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PageService } from '../services/page.service.js';
import { PageTranslationService } from '../services/page-translation.service.js';
import type { ICacheService, IContentActor, ICurationService } from '@/types';
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

/** A signed-in admin: a curator whose writes are approved at once. */
const curator: IContentActor = { id: 'user-admin', kind: 'user', isCurator: true };

/** The shared service token: not a curator, so reviewed changes are held. */
const serviceToken: IContentActor = { id: 'system:service-token', kind: 'system', isCurator: false };

/**
 * Build page or translation markdown with frontmatter.
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

describe('PageTranslationService', () => {
    let pages: PageService;
    let translations: PageTranslationService;
    let onRoutesChanged: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
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
        ContentService.setDependencies(
            database,
            new HookRegistry(mockLogger),
            createMockServiceRegistry({ curation: curation as unknown as ICurationService }),
            mockLogger
        );
        const contentService = ContentService.getInstance();
        onRoutesChanged = vi.fn<() => void>();

        PageService.setDependencies(database, cache, contentService, mockLogger, onRoutesChanged);
        pages = PageService.getInstance();
        PageTranslationService.setDependencies({
            database,
            cacheService: cache,
            contentService,
            pages,
            onRoutesChanged,
            logger: mockLogger
        });
        translations = PageTranslationService.getInstance();
        contentService.registerType(pages.getContentType(), 'pages');
        contentService.registerType(translations.getContentType(), 'pages');
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
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于', published: true }), curator);

            expect(await translations.listLocalizedRoutes()).toEqual([
                { pattern: '/about', languages: ['zh'] },
                { pattern: '/company', languages: ['zh'] }
            ]);
        });

        it('does not list a draft translation', async () => {
            const pageId = await createPage('/about');
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于' }), curator);

            expect(await translations.listLocalizedRoutes()).toEqual([]);
        });

        it('does not list a translation still waiting for review', async () => {
            const pageId = await createPage('/about');
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于', published: true }), serviceToken);

            expect(await translations.listLocalizedRoutes()).toEqual([]);
        });

        it('stops listing a translation once it is deleted', async () => {
            const pageId = await createPage('/about');
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于', published: true }), curator);
            await translations.deleteTranslation(pageId, 'zh', curator);

            expect(await translations.listLocalizedRoutes()).toEqual([]);
            expect(onRoutesChanged).toHaveBeenCalled();
        });

        it('leaves out an old slug that would act as a route pattern', async () => {
            const pageId = await createPage('/about', { oldSlugs: ['/blog/*'] });
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于', published: true }), curator);

            expect(await translations.listLocalizedRoutes()).toEqual([{ pattern: '/about', languages: ['zh'] }]);
        });
    });

    describe('renderPublicTranslation', () => {
        it('renders the translated body and metadata', async () => {
            const pageId = await createPage('/about', { ogImage: '/uploads/en.png' });
            await translations.createTranslation(
                pageId,
                'zh',
                markdown({ title: '关于', published: true, body: '你好' }),
                curator
            );

            const render = await translations.renderPublicTranslation('/about', 'zh');
            expect(render?.html).toContain('你好');
            expect(render?.metadata.title).toBe('关于');
            // No ogImage in the translation, so the page's image is used.
            expect(render?.metadata.ogImage).toBe('/uploads/en.png');
        });

        it('returns null rather than the English body when no translation exists', async () => {
            await createPage('/about');
            expect(await translations.renderPublicTranslation('/about', 'zh')).toBeNull();
        });

        it('returns null for a draft translation', async () => {
            const pageId = await createPage('/about');
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于' }), curator);

            expect(await translations.renderPublicTranslation('/about', 'zh')).toBeNull();
        });

        it('returns null for a malformed language code', async () => {
            await createPage('/about');
            expect(await translations.renderPublicTranslation('/about', '../x')).toBeNull();
        });
    });

    describe('admin management', () => {
        it('refuses a translation into the default language', async () => {
            const pageId = await createPage('/about');
            await expect(
                translations.createTranslation(pageId, 'en', markdown({ title: 'About' }), curator)
            ).rejects.toThrow(/another language/);
        });

        it('refuses a second translation into the same language', async () => {
            const pageId = await createPage('/about');
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于' }), curator);
            await expect(
                translations.createTranslation(pageId, 'zh', markdown({ title: '关于' }), curator)
            ).rejects.toThrow(/already has a translation/);
        });

        it('flags a translation stale after the English page changes, and clears it on save', async () => {
            const pageId = await createPage('/about');
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于' }), curator);
            expect((await translations.listTranslations(pageId))[0].stale).toBe(false);

            await pages.updatePage(pageId, markdown({ title: 'About us', slug: '/about', published: true }), curator);
            expect((await translations.listTranslations(pageId))[0].stale).toBe(true);

            await translations.updateTranslation(pageId, 'zh', markdown({ title: '关于我们' }), curator);
            expect((await translations.listTranslations(pageId))[0].stale).toBe(false);
        });

        it('hands the Suggest button a previous translation only when it is stale', async () => {
            const pageId = await createPage('/about');
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于', published: true }), curator);

            const current = await translations.getSuggestionSource(pageId, 'zh');
            expect(current.previous).toBeNull();
            expect(current.published).toBe(true);

            await pages.updatePage(pageId, markdown({ title: 'About us', slug: '/about', published: true }), curator);
            const stale = await translations.getSuggestionSource(pageId, 'zh');
            expect(stale.english.title).toBe('About us');
            expect(stale.previous?.title).toBe('关于');
        });

        it('does not flag a translation stale when only the English slug changes', async () => {
            const pageId = await createPage('/about');
            await translations.createTranslation(pageId, 'zh', markdown({ title: '关于' }), curator);
            await pages.updatePage(pageId, markdown({ title: 'About', slug: '/about-us', published: true }), curator);

            expect((await translations.listTranslations(pageId))[0].stale).toBe(false);
        });
    });
});
