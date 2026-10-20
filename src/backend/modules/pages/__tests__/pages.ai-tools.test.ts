/**
 * Unit tests for the pages AI tools.
 *
 * They pin what the tools promise a model: they are public reads, list and
 * search return summaries without bodies, `pages-get` accepts ids, slugs, and
 * URLs and caps each body, and a bad argument comes back as an input error the
 * model can correct from rather than as a failure. Which pages are visible is
 * the service's rule and is covered in `page.service.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IPageService, IPublicPage, ISystemLogService } from '@/types';
import { AI_TOOL_NAMES, buildPageAiTools } from '../ai-tools.js';

/** A content id in the shape core issues. */
const PAGE_ID = '3f2b8c1e-9d4a-4e7b-8a1c-5d6e7f809a1b';

/**
 * A public page with sensible defaults.
 *
 * @param overrides - Fields that differ from a short published page at `/about`.
 * @returns The page.
 */
function publicPage(overrides: Partial<IPublicPage> = {}): IPublicPage {
    return {
        id: PAGE_ID,
        slug: '/about',
        title: 'About',
        description: 'Who runs TronRelic.',
        keywords: ['about'],
        body: '# About\n\nTronRelic tracks the [TRON](https://tron.network) network.',
        updatedAt: new Date('2026-10-01T00:00:00Z'),
        ...overrides
    };
}

/**
 * Build the tools over a fake service.
 *
 * @param service - The fake service methods the test needs.
 * @returns The tools keyed by name.
 */
function buildTools(service: Partial<IPageService>): Record<string, ReturnType<typeof buildPageAiTools>[number]> {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
    const tools = buildPageAiTools(service as IPageService, logger);
    return Object.fromEntries(tools.map(tool => [tool.name, tool]));
}

describe('pages AI tools', () => {
    it('are named after the module and classified as public reads', () => {
        const tools = buildTools({});

        expect(Object.keys(tools).sort()).toEqual(Object.values(AI_TOOL_NAMES).sort());
        for (const tool of Object.values(tools)) {
            expect(tool.name.startsWith('pages-')).toBe(true);
            expect(tool.capability).toEqual({ sideEffect: 'read', reversible: true, sensitivity: 'public' });
        }
    });

    it('lists summaries with a plain-text excerpt and no body', async () => {
        const listPublicPages = vi.fn(async () => ({ pages: [publicPage()], total: 1 }));
        const tool = buildTools({ listPublicPages })[AI_TOOL_NAMES.list];

        const result = await tool.handler({}) as Record<string, any>;

        expect(listPublicPages).toHaveBeenCalledWith({ limit: 20, skip: 0 });
        expect(result).toMatchObject({ success: true, total: 1, page: 1, limit: 20, hasMore: false });
        expect(result.pages[0]).toEqual({
            id: PAGE_ID,
            slug: '/about',
            title: 'About',
            description: 'Who runs TronRelic.',
            keywords: ['about'],
            updatedAt: '2026-10-01T00:00:00.000Z',
            excerpt: 'About TronRelic tracks the TRON network.'
        });
        expect(result.pages[0].body).toBeUndefined();
    });

    it('turns page and limit into a skip and reports whether more remain', async () => {
        const listPublicPages = vi.fn(async () => ({ pages: [publicPage(), publicPage()], total: 7 }));
        const tool = buildTools({ listPublicPages })[AI_TOOL_NAMES.list];

        const result = await tool.handler({ page: 2, limit: 2 }) as Record<string, any>;

        expect(listPublicPages).toHaveBeenCalledWith({ limit: 2, skip: 2 });
        expect(result.hasMore).toBe(true);
    });

    it('refuses a limit outside the range as an input error', async () => {
        const listPublicPages = vi.fn();
        const tool = buildTools({ listPublicPages })[AI_TOOL_NAMES.list];

        const result = await tool.handler({ limit: 500 }) as Record<string, any>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(listPublicPages).not.toHaveBeenCalled();
    });

    it('passes the trimmed query to the service and refuses an empty one', async () => {
        const listPublicPages = vi.fn(async () => ({ pages: [], total: 0 }));
        const tool = buildTools({ listPublicPages })[AI_TOOL_NAMES.search];

        const found = await tool.handler({ query: '  energy rental ' }) as Record<string, any>;
        const refused = await tool.handler({ query: '   ' }) as Record<string, any>;

        expect(listPublicPages).toHaveBeenCalledTimes(1);
        expect(listPublicPages).toHaveBeenCalledWith({ search: 'energy rental', limit: 20, skip: 0 });
        expect(found).toMatchObject({ success: true, query: 'energy rental', total: 0, pages: [] });
        expect(refused).toMatchObject({ success: false, errorKind: 'input' });
    });

    it('reads pages by id, slug, and URL, normalizing each and keeping the order', async () => {
        const getPublicPages = vi.fn(async (identifiers: ReadonlyArray<string>) =>
            identifiers.map((identifier) => (identifier === '/missing' ? null : publicPage()))
        );
        const tool = buildTools({ getPublicPages })[AI_TOOL_NAMES.get];

        const result = await tool.handler({
            pages: [PAGE_ID.toUpperCase(), '/guides/energy/', 'https://tronrelic.com/about?ref=x#top', '/missing']
        }) as Record<string, any>;

        expect(getPublicPages).toHaveBeenCalledWith([PAGE_ID, '/guides/energy', '/about', '/missing']);
        expect(result.pages.map((entry: any) => [entry.requested, entry.found])).toEqual([
            [PAGE_ID.toUpperCase(), true],
            ['/guides/energy/', true],
            ['https://tronrelic.com/about?ref=x#top', true],
            ['/missing', false]
        ]);
        expect(result.pages[0].page).toMatchObject({ slug: '/about', markdown: publicPage().body, truncated: false });
        expect(result.pages[3].page).toBeNull();
    });

    it('caps a long body and says how long it was', async () => {
        const body = 'x'.repeat(25000);
        const getPublicPages = vi.fn(async () => [publicPage({ body })]);
        const tool = buildTools({ getPublicPages })[AI_TOOL_NAMES.get];

        const result = await tool.handler({ pages: ['/about'] }) as Record<string, any>;

        expect(result.pages[0].page.markdown).toHaveLength(20000);
        expect(result.pages[0].page).toMatchObject({ truncated: true, totalCharacters: 25000 });
    });

    it('refuses an identifier that is not an id, slug, or URL, and too many pages', async () => {
        const getPublicPages = vi.fn();
        const tool = buildTools({ getPublicPages })[AI_TOOL_NAMES.get];

        const notAnId = await tool.handler({ pages: ['about'] }) as Record<string, any>;
        const tooMany = await tool.handler({ pages: ['/a', '/b', '/c', '/d', '/e', '/f'] }) as Record<string, any>;

        expect(notAnId).toMatchObject({ success: false, errorKind: 'input' });
        expect(notAnId.error).toContain('pages-list');
        expect(tooMany).toMatchObject({ success: false, errorKind: 'input' });
        expect(getPublicPages).not.toHaveBeenCalled();
    });

    it('reports a service failure as not caused by the input', async () => {
        const getPublicPages = vi.fn(async () => { throw new Error('mongo down'); });
        const tool = buildTools({ getPublicPages })[AI_TOOL_NAMES.get];

        const result = await tool.handler({ pages: ['/about'] }) as Record<string, any>;

        expect(result).toMatchObject({ success: false, errorKind: 'failed' });
        expect(result.error).not.toContain('mongo');
    });
});
