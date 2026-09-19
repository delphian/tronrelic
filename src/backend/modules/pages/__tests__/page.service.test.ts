/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PageService } from '../services/page.service.js';
import type { ICacheService, IContentActor, ICurationService } from '@/types';
import { ObjectId } from 'mongodb';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { ContentService } from '../../../services/content-service.js';
import { HookRegistry } from '../../../hooks/hook-registry.js';

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

/** A signed-in admin: a curator whose page writes are approved at once. */
const curator: IContentActor = { id: 'user-admin', kind: 'user', isCurator: true };

/** The shared service token: not a curator, so reviewed changes are held. */
const serviceToken: IContentActor = { id: 'system:service-token', kind: 'system', isCurator: false };

function makePageMarkdown(opts: { title: string; slug?: string; published?: boolean; body?: string }) {
    const lines = ['---', `title: "${opts.title}"`];
    if (opts.slug) lines.push(`slug: "${opts.slug}"`);
    if (opts.published) lines.push('published: true');
    lines.push('---', '', `# ${opts.title}`, '', opts.body ?? 'Body.');
    return lines.join('\n');
}

describe('PageService', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let service: PageService;
    let curation: { registerType: ReturnType<typeof vi.fn>; unregisterType: ReturnType<typeof vi.fn>; hold: ReturnType<typeof vi.fn>; approve: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        PageService.resetForTests();
        ContentService.resetForTests();
        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        curation = {
            registerType: vi.fn(),
            unregisterType: vi.fn(),
            hold: vi.fn(async () => ({ id: `item-${Math.random()}`, status: 'pending' })),
            approve: vi.fn(async () => null)
        };

        ContentService.setDependencies(
            mockDatabase,
            new HookRegistry(mockLogger),
            createMockServiceRegistry({ curation: curation as unknown as ICurationService }),
            mockLogger
        );
        const contentService = ContentService.getInstance();
        PageService.setDependencies(mockDatabase, mockCache, contentService, mockLogger);
        service = PageService.getInstance();
        contentService.registerType(service.getContentType(), 'pages');
    });

    describe('createPage', () => {
        it('parses frontmatter, issues a content id, and approves a curator\'s page', async () => {
            const page = await service.createPage(
                makePageMarkdown({ title: 'Hello World', slug: '/hello', published: true }),
                curator
            );

            expect(page.title).toBe('Hello World');
            expect(page.slug).toBe('/hello');
            expect(page.published).toBe(true);
            expect(page.contentId).toMatch(/^[0-9a-f-]{36}$/);
            expect(page.curation).toBe('approved');
            expect(page.hasApprovedVersion).toBe(true);
        });

        it('holds a page created with the service token for review', async () => {
            const page = await service.createPage(makePageMarkdown({ title: 'Held', slug: '/held', published: true }), serviceToken);

            expect(page.curation).toBe('pending');
            expect(curation.hold).toHaveBeenCalledWith(expect.objectContaining({ typeId: 'core:page', ref: { id: page.contentId, holdId: expect.any(String) } }));
            expect(await service.getPublicPageBySlug('/held')).toBeNull();
        });

        it('generates a slug from title when frontmatter omits it', async () => {
            const page = await service.createPage(makePageMarkdown({ title: 'Some Title' }), curator);
            expect(page.slug).toBe('/some-title');
        });

        it('throws when title is missing', async () => {
            await expect(service.createPage('---\nslug: "/x"\n---\n# X', curator)).rejects.toThrow(/title/i);
        });

        it('throws when the slug is already in use', async () => {
            await service.createPage(makePageMarkdown({ title: 'A', slug: '/dup' }), curator);
            await expect(
                service.createPage(makePageMarkdown({ title: 'B', slug: '/dup' }), curator)
            ).rejects.toThrow(/already exists/);
        });

        it('throws when the slug matches a blacklist pattern', async () => {
            await expect(
                service.createPage(makePageMarkdown({ title: 'X', slug: '/api/foo' }), curator)
            ).rejects.toThrow(/blacklisted/);
        });
    });

    describe('updatePage', () => {
        it('preserves the previous slug in oldSlugs when slug changes', async () => {
            const created = await service.createPage(makePageMarkdown({ title: 'A', slug: '/a' }), curator);
            const updated = await service.updatePage(
                created.contentId!,
                makePageMarkdown({ title: 'A', slug: '/a-new' }),
                curator
            );
            expect(updated.slug).toBe('/a-new');
            expect(updated.oldSlugs).toContain('/a');
        });

        it('lets a page move back to its live slug after a held rename is rejected', async () => {
            const created = await service.createPage(makePageMarkdown({ title: 'A', slug: '/a', published: true }), curator);
            await service.updatePage(created.contentId!, makePageMarkdown({ title: 'A', slug: '/b', published: true }), serviceToken);
            const [{ ref }] = curation.hold.mock.calls.at(-1)!;
            await ContentService.getInstance().applyDecision('core:page', ref, 'rejected');

            const reverted = await service.updatePage(
                created.contentId!,
                makePageMarkdown({ title: 'A', slug: '/a', published: true }),
                serviceToken
            );

            expect(reverted.slug).toBe('/a');
            expect(reverted.oldSlugs).not.toContain('/a');
        });

        it('rejects an unknown content id with the not-found code', async () => {
            await expect(
                service.updatePage(new ObjectId().toHexString(), makePageMarkdown({ title: 'X' }), curator)
            ).rejects.toMatchObject({ code: 'not-found' });
        });

        it('keeps serving the approved page while a service-token edit waits for review', async () => {
            const created = await service.createPage(
                makePageMarkdown({ title: 'Live', slug: '/live', published: true, body: 'Approved body.' }),
                curator
            );

            const updated = await service.updatePage(
                created.contentId!,
                makePageMarkdown({ title: 'Live', slug: '/live', published: true, body: 'Proposed body.' }),
                serviceToken
            );

            expect(updated.curation).toBe('pending');
            const render = await service.renderPublicPageBySlug('/live');
            expect(render?.html).toContain('Approved body.');
            expect(render?.html).not.toContain('Proposed body.');
        });
    });

    describe('public reads', () => {
        it('finds a published page by current slug', async () => {
            await service.createPage(makePageMarkdown({ title: 'A', slug: '/find-me', published: true }), curator);
            const found = await service.getPublicPageBySlug('/find-me');
            expect(found?.slug).toBe('/find-me');
        });

        it('does not serve an unpublished page', async () => {
            await service.createPage(makePageMarkdown({ title: 'A', slug: '/draft' }), curator);
            expect(await service.getPublicPageBySlug('/draft')).toBeNull();
        });

        it('finds a page by old slug after a rename', async () => {
            const created = await service.createPage(makePageMarkdown({ title: 'A', slug: '/old', published: true }), curator);
            await service.updatePage(created.contentId!, makePageMarkdown({ title: 'A', slug: '/new', published: true }), curator);
            const redirect = await service.findPublicPageByOldSlug('/old');
            expect(redirect?.slug).toBe('/new');
        });

        it('serves a page the migration has not adopted yet by its own published flag', async () => {
            await mockDatabase.getCollection('pages').insertOne({
                _id: new ObjectId(),
                title: 'Legacy',
                slug: '/legacy',
                oldSlugs: [],
                content: makePageMarkdown({ title: 'Legacy', slug: '/legacy', published: true }),
                description: '',
                keywords: [],
                published: true,
                ogImage: null,
                authorId: null,
                createdAt: new Date(),
                updatedAt: new Date()
            });

            const found = await service.getPublicPageBySlug('/legacy');
            expect(found?.title).toBe('Legacy');
            expect(found?.contentId).toBeUndefined();
        });
    });

    describe('listPages / getPageStats', () => {
        it('returns aggregate counts including review and deletion', async () => {
            await service.createPage(makePageMarkdown({ title: 'P1', slug: '/p1', published: true }), curator);
            await service.createPage(makePageMarkdown({ title: 'P2', slug: '/p2' }), curator);
            await service.createPage(makePageMarkdown({ title: 'P3', slug: '/p3' }), serviceToken);
            const gone = await service.createPage(makePageMarkdown({ title: 'P4', slug: '/p4' }), curator);
            await service.deletePage(gone.contentId!, curator);

            const stats = await service.getPageStats();
            expect(stats.total).toBe(3);
            expect(stats.published).toBe(1);
            expect(stats.drafts).toBe(2);
            expect(stats.pendingReview).toBe(1);
            expect(stats.deleted).toBe(1);
        });

        it('decorates listed pages with review state', async () => {
            await service.createPage(makePageMarkdown({ title: 'Held', slug: '/held' }), serviceToken);
            const pages = await service.listPages({ curation: 'pending' });
            expect(pages).toHaveLength(1);
            expect(pages[0].curation).toBe('pending');
        });
    });

    describe('deletePage / restorePage', () => {
        it('soft-deletes: hidden publicly, kept for admins, slug still reserved', async () => {
            const created = await service.createPage(makePageMarkdown({ title: 'X', slug: '/x', published: true }), curator);

            await service.deletePage(created.contentId!, curator);

            expect(await service.getPublicPageBySlug('/x')).toBeNull();
            expect((await service.getPageById(created.contentId!))?.deletedAt).toBeDefined();
            await expect(
                service.createPage(makePageMarkdown({ title: 'Y', slug: '/x' }), curator)
            ).rejects.toThrow(/already exists/);
        });

        it('restores a deleted page', async () => {
            const created = await service.createPage(makePageMarkdown({ title: 'X', slug: '/x', published: true }), curator);
            await service.deletePage(created.contentId!, curator);

            const restored = await service.restorePage(created.contentId!, curator);

            expect(restored.deletedAt).toBeUndefined();
            expect(await service.getPublicPageBySlug('/x')).not.toBeNull();
        });
    });

    describe('listSitemapPages', () => {
        it('lists only pages a visitor can reach', async () => {
            await service.createPage(makePageMarkdown({ title: 'Live', slug: '/live', published: true }), curator);
            await service.createPage(makePageMarkdown({ title: 'Held', slug: '/held', published: true }), serviceToken);
            const gone = await service.createPage(makePageMarkdown({ title: 'Gone', slug: '/gone', published: true }), curator);
            await service.deletePage(gone.contentId!, curator);

            const entries = await service.listSitemapPages();
            expect(entries.map((entry) => entry.slug)).toEqual(['/live']);
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
