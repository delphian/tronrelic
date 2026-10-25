/**
 * Unit tests for the pages AI tools.
 *
 * They pin what the tools promise a model: the three reads are public reads,
 * list and search return summaries without bodies, `pages-get` accepts ids,
 * slugs, and URLs and caps each body, and a bad argument comes back as an
 * input error the model can correct from rather than as a failure. The edit
 * tool declares its curation binding, checks the page id, and reports the
 * service's refusals. Which pages are visible, and how an edit is held for
 * review, are the service's rules and are covered in `page.service.test.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IPageService, IPublicPage, ISystemLogService } from '@/types';
import { AI_TOOL_NAMES, buildPageAiTools } from '../ai-tools.js';
import { PageEditInputError } from '../services/PageEditInputError.js';
import { ContentError } from '../../../services/content-error.js';

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
    it('are named after the module, with the three reads classified as public reads', () => {
        const tools = buildTools({});

        expect(Object.keys(tools).sort()).toEqual(Object.values(AI_TOOL_NAMES).sort());
        for (const tool of Object.values(tools)) {
            expect(tool.name.startsWith('pages-')).toBe(true);
        }
        for (const name of [AI_TOOL_NAMES.list, AI_TOOL_NAMES.search, AI_TOOL_NAMES.get]) {
            expect(tools[name].capability).toEqual({ sideEffect: 'read', reversible: true, sensitivity: 'public' });
        }
    });

    it('keeps every input example valid against its own schema', () => {
        // The provider rejects a whole tool definition whose example does not
        // conform, so every tool that ships examples is checked.
        for (const tool of Object.values(buildTools({}))) {
            const required = (tool.inputSchema.required as string[] | undefined) ?? [];
            const properties = tool.inputSchema.properties as Record<string, unknown>;
            for (const example of tool.inputExamples ?? []) {
                for (const field of required) {
                    expect(Object.keys(example)).toContain(field);
                }
                for (const key of Object.keys(example)) {
                    expect(properties[key]).toBeDefined();
                }
            }
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

describe('pages-propose-edit AI tool', () => {
    it('declares the verifiable curation binding for core:page', () => {
        const tool = buildTools({})[AI_TOOL_NAMES.proposeEdit];

        expect(tool.capability).toEqual({
            sideEffect: 'external',
            reversible: false,
            sensitivity: 'public',
            forcesCuratorReview: true,
            curationTypeId: 'core:page'
        });
        expect(tool.inputSchema.required).toEqual(['pageId']);
        const properties = Object.keys(tool.inputSchema.properties as Record<string, unknown>);
        expect(properties).not.toContain('slug');
        expect(properties).not.toContain('published');
    });

    it('forwards the edit to the service with the tool as its source', async () => {
        const proposeEdit = vi.fn(async () => ({ pageId: PAGE_ID, slug: '/about', pendingReview: true, curationId: 'item-1' }));
        const tool = buildTools({ proposeEdit })[AI_TOOL_NAMES.proposeEdit];

        const result = await tool.handler({ pageId: PAGE_ID.toUpperCase(), title: 'About Us' }) as Record<string, any>;

        expect(proposeEdit).toHaveBeenCalledWith(PAGE_ID, expect.objectContaining({ title: 'About Us', source: 'ai-tool:pages-propose-edit' }));
        expect(result).toEqual({ success: true, pageId: PAGE_ID, slug: '/about', pendingReview: true });
    });

    it('refuses a malformed page id without calling the service', async () => {
        const proposeEdit = vi.fn();
        const tool = buildTools({ proposeEdit })[AI_TOOL_NAMES.proposeEdit];

        const result = await tool.handler({ pageId: '/about', title: 'About Us' }) as Record<string, any>;

        expect(result).toMatchObject({ success: false, errorKind: 'input' });
        expect(proposeEdit).not.toHaveBeenCalled();
    });

    it('returns the service\'s field refusals and an unknown page as input errors', async () => {
        const proposeEdit = vi.fn()
            .mockRejectedValueOnce(new PageEditInputError('Provide at least one of title, body, description, keywords, or ogImage.'))
            .mockRejectedValueOnce(new ContentError('not-found', `No page has id ${PAGE_ID}`));
        const tool = buildTools({ proposeEdit })[AI_TOOL_NAMES.proposeEdit];

        const empty = await tool.handler({ pageId: PAGE_ID }) as Record<string, any>;
        const unknown = await tool.handler({ pageId: PAGE_ID, title: 'X' }) as Record<string, any>;

        expect(empty).toMatchObject({ success: false, errorKind: 'input', error: expect.stringContaining('at least one') });
        expect(unknown).toMatchObject({ success: false, errorKind: 'input', error: expect.stringContaining('No page') });
    });

    it('tells the model nothing was stored when curation is unavailable', async () => {
        const proposeEdit = vi.fn(async () => { throw new ContentError('curation-unavailable', 'queue down'); });
        const tool = buildTools({ proposeEdit })[AI_TOOL_NAMES.proposeEdit];

        const result = await tool.handler({ pageId: PAGE_ID, title: 'X' }) as Record<string, any>;

        expect(result).toMatchObject({ success: false, errorKind: 'failed' });
        expect(result.error).toContain('not stored');
    });
});
