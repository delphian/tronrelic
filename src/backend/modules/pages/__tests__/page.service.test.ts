/// <reference types="vitest" />

import { describe, it, expect, beforeEach } from 'vitest';
import { PageService } from '../services/page.service.js';
import type { ICacheService } from '@/types';
import { ObjectId } from 'mongodb';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

class MockCacheService implements ICacheService {
    private cache = new Map<string, { value: any; ttl?: number }>();
    async get<T = any>(key: string): Promise<T | null> {
        const entry = this.cache.get(key);
        return entry ? (entry.value as T) : null;
    }
    async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        this.cache.set(key, { value, ttl });
    }
    async del(key: string): Promise<number> {
        return this.cache.delete(key) ? 1 : 0;
    }
    async invalidate(_pattern: string): Promise<void> {}
    async keys(pattern: string): Promise<string[]> {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return [...this.cache.keys()].filter(k => regex.test(k));
    }
    clear(): void { this.cache.clear(); }
}

const mockLogger: any = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    child: () => mockLogger
};

function makePageMarkdown(opts: { title: string; slug?: string; published?: boolean }) {
    const lines = ['---', `title: "${opts.title}"`];
    if (opts.slug) lines.push(`slug: "${opts.slug}"`);
    if (opts.published) lines.push('published: true');
    lines.push('---', '', `# ${opts.title}`, '', 'Body.');
    return lines.join('\n');
}

describe('PageService', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let service: PageService;

    beforeEach(() => {
        PageService.resetForTests();
        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();

        PageService.setDependencies(mockDatabase, mockCache, mockLogger);
        service = PageService.getInstance();
    });

    describe('createPage', () => {
        it('parses frontmatter and writes a page document', async () => {
            const page = await service.createPage(
                makePageMarkdown({ title: 'Hello World', slug: '/hello', published: true })
            );

            expect(page.title).toBe('Hello World');
            expect(page.slug).toBe('/hello');
            expect(page.published).toBe(true);
        });

        it('generates a slug from title when frontmatter omits it', async () => {
            const page = await service.createPage(
                makePageMarkdown({ title: 'Some Title' })
            );
            expect(page.slug).toBe('/some-title');
        });

        it('throws when title is missing', async () => {
            await expect(service.createPage('---\nslug: "/x"\n---\n# X')).rejects.toThrow(/title/i);
        });

        it('throws when the slug is already in use', async () => {
            await service.createPage(makePageMarkdown({ title: 'A', slug: '/dup' }));
            await expect(
                service.createPage(makePageMarkdown({ title: 'B', slug: '/dup' }))
            ).rejects.toThrow(/already exists/);
        });

        it('throws when the slug matches a blacklist pattern', async () => {
            await expect(
                service.createPage(makePageMarkdown({ title: 'X', slug: '/api/foo' }))
            ).rejects.toThrow(/blacklisted/);
        });
    });

    describe('updatePage', () => {
        it('preserves the previous slug in oldSlugs when slug changes', async () => {
            const created = await service.createPage(makePageMarkdown({ title: 'A', slug: '/a' }));
            const updated = await service.updatePage(
                created._id!,
                makePageMarkdown({ title: 'A', slug: '/a-new' })
            );
            expect(updated.slug).toBe('/a-new');
            expect(updated.oldSlugs).toContain('/a');
        });

        it('throws when the page does not exist', async () => {
            await expect(
                service.updatePage(new ObjectId().toHexString(), makePageMarkdown({ title: 'X' }))
            ).rejects.toThrow(/not found/);
        });
    });

    describe('getPageBySlug / findPageByOldSlug', () => {
        it('finds a page by current slug', async () => {
            await service.createPage(makePageMarkdown({ title: 'A', slug: '/find-me' }));
            const found = await service.getPageBySlug('/find-me');
            expect(found?.slug).toBe('/find-me');
        });

        it('finds a page by old slug after rename', async () => {
            const created = await service.createPage(makePageMarkdown({ title: 'A', slug: '/old' }));
            await service.updatePage(created._id!, makePageMarkdown({ title: 'A', slug: '/new' }));
            const redirect = await service.findPageByOldSlug('/old');
            expect(redirect?.slug).toBe('/new');
        });
    });

    describe('listPages / getPageStats', () => {
        it('returns aggregate counts', async () => {
            await service.createPage(makePageMarkdown({ title: 'P1', slug: '/p1', published: true }));
            await service.createPage(makePageMarkdown({ title: 'P2', slug: '/p2' }));
            const stats = await service.getPageStats();
            expect(stats.total).toBe(2);
            expect(stats.published).toBe(1);
            expect(stats.drafts).toBe(1);
        });
    });

    describe('deletePage', () => {
        it('removes the page', async () => {
            const created = await service.createPage(makePageMarkdown({ title: 'X', slug: '/x' }));
            await service.deletePage(created._id!);
            expect(await service.getPageById(created._id!)).toBeNull();
        });
    });

    describe('settings', () => {
        it('seeds defaults and exposes only page-level fields', async () => {
            const settings = await service.getSettings();
            expect(Array.isArray(settings.blacklistedRoutes)).toBe(true);
            expect(settings.blacklistedRoutes.length).toBeGreaterThan(0);
            // File policy fields are not part of IPageSettings anymore.
            expect((settings as any).maxFileSize).toBeUndefined();
            expect((settings as any).allowedFileExtensions).toBeUndefined();
        });

        it('persists blacklist updates', async () => {
            const updated = await service.updateSettings({ blacklistedRoutes: ['^/blocked/.*'] });
            expect(updated.blacklistedRoutes).toEqual(['^/blocked/.*']);
        });
    });

    describe('sanitizeSlug', () => {
        it('lowercases, hyphenates, and prefixes with /', () => {
            expect(service.sanitizeSlug('Hello World!')).toBe('/hello-world');
        });

        it('collapses repeated hyphens', () => {
            expect(service.sanitizeSlug('a---b')).toBe('/a-b');
        });
    });

    describe('isSlugBlacklisted', () => {
        it('matches blacklist patterns from settings', async () => {
            expect(await service.isSlugBlacklisted('/api/foo')).toBe(true);
            expect(await service.isSlugBlacklisted('/about')).toBe(false);
        });
    });
});
