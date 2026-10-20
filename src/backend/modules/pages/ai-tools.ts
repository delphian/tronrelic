/**
 * @fileoverview Read-only AI tools over the published CMS pages.
 *
 * Pages are the admin-authored content at addresses such as `/about` or
 * `/guides/energy`. An agent answering a question about the site, or drafting
 * something that should agree with it, needs to find out which pages exist,
 * find the ones about a topic, and read them. These three tools cover that:
 *
 * - `pages-list`: every published page, most recently changed first, as a
 *   short summary with no body.
 * - `pages-search`: the same summaries, kept only where a literal text appears.
 * - `pages-get`: up to five pages in full, by content id, slug, or URL.
 *
 * All three see exactly what a visitor sees and nothing else. The visibility
 * rule lives in `IPageService.listPublicPages` and `getPublicPages`, which go
 * through the core content service, so drafts, edits still waiting for review,
 * and deleted pages never reach a tool. That is what lets the tools declare
 * `public` sensitivity: they can be granted to any MCP user and run in
 * scheduled prompts without exposing anything a visitor could not already read.
 *
 * @module backend/modules/pages/ai-tools
 */

import type {
    IAiTool,
    IAiToolCapability,
    IAiToolRegistry,
    IPageService,
    IPublicPage,
    IServiceRegistry,
    ISystemLogService,
    ServiceWatchDisposer
} from '@/types';

/** Provider id passed to `registerTool`, so the admin page groups these under this module. */
const PROVIDER_ID = 'pages';

/**
 * Every tool's name, led by the module id. Spelled once here so the `name`
 * fields, the cross-references inside sibling descriptions, and the log
 * context cannot drift apart. Renaming a shipped tool drops its stored
 * enabled state and policy overrides and breaks any saved prompt naming it.
 */
export const AI_TOOL_NAMES = {
    list: 'pages-list',
    search: 'pages-search',
    get: 'pages-get'
} as const;

/**
 * The classification all three tools declare.
 *
 * Read-only, free, and `public`, because the service returns only what a
 * visitor is served. Not `surfacesUntrustedContent`: every served version
 * was written or approved by a curator, since core holds any other author's
 * change for review before visitors see it.
 */
const PAGE_READ_CAPABILITY: IAiToolCapability = {
    sideEffect: 'read',
    reversible: true,
    sensitivity: 'public'
};

/** Summaries returned per call when the caller does not say, and the most it may ask for. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** Longest search text accepted, so the query stays a phrase rather than a pasted document. */
const MAX_QUERY_LENGTH = 100;

/** Most pages one `pages-get` call reads. */
const MAX_GET_PAGES = 5;

/**
 * Longest markdown body returned per page. Five pages at this size is about
 * 100,000 characters, which bounds how much of the model's context one call
 * can spend.
 */
const MAX_BODY_CHARACTERS = 20000;

/** Length of the plain-text opening each summary carries. */
const EXCERPT_CHARACTERS = 240;

/** Longest identifier accepted by `pages-get`, which covers any real URL. */
const MAX_IDENTIFIER_LENGTH = 500;

/** Shape of a core content id, which `crypto.randomUUID()` issues. */
const CONTENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sentence every description ends with, stating what the three tools share. */
const SHARED_DESCRIPTION =
    'Pages are TronRelic\'s admin-written site pages (guides, explainers, policies, announcements) served at paths such as /about. ' +
    'These tools return only published pages exactly as visitors see them; drafts and edits waiting for review are never returned. ' +
    'Blog posts are separate and are not pages. Read-only; never changes a page.';

/** One page as the list and search tools return it. */
interface IPageSummaryView {
    /** Core content id, or null for an older page that can only be read by slug. */
    id: string | null;
    slug: string;
    title: string;
    description: string;
    keywords: string[];
    updatedAt: string;
    excerpt: string;
}

/** A refusal written for the model, carried as a thrown error so validation can stay in small helpers. */
class PageToolInputError extends Error {}

/**
 * Turn a page's markdown into a short plain-text opening.
 *
 * Summaries carry this so the model can pick the right page without spending
 * a `pages-get` call on each candidate. Link and image syntax keeps only its
 * text, and the remaining markdown punctuation is dropped, because the model
 * reads the excerpt as prose.
 *
 * @param markdown - The page body, without frontmatter.
 * @returns At most `EXCERPT_CHARACTERS` characters of plain text, ending in an ellipsis when cut.
 */
function toExcerpt(markdown: string): string {
    const text = markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[#>*_`~|]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    return text.length > EXCERPT_CHARACTERS ? `${text.slice(0, EXCERPT_CHARACTERS).trimEnd()}…` : text;
}

/**
 * Reduce a public page to the summary the list and search tools return.
 *
 * @param page - The page from the service.
 * @returns The summary, without the body.
 */
function toSummaryView(page: IPublicPage): IPageSummaryView {
    return {
        id: page.id,
        slug: page.slug,
        title: page.title,
        description: page.description,
        keywords: page.keywords,
        updatedAt: page.updatedAt.toISOString(),
        excerpt: toExcerpt(page.body)
    };
}

/**
 * Reduce a public page to the full view `pages-get` returns, capping the body.
 *
 * @param page - The page from the service.
 * @returns The page with its markdown, `truncated` set when the body was cut,
 *   and the full length so the model knows how much it did not see.
 */
function toFullView(page: IPublicPage): Record<string, unknown> {
    const truncated = page.body.length > MAX_BODY_CHARACTERS;

    return {
        id: page.id,
        slug: page.slug,
        title: page.title,
        description: page.description,
        keywords: page.keywords,
        ...(page.ogImage ? { ogImage: page.ogImage } : {}),
        updatedAt: page.updatedAt.toISOString(),
        markdown: truncated ? page.body.slice(0, MAX_BODY_CHARACTERS) : page.body,
        truncated,
        ...(truncated ? { totalCharacters: page.body.length } : {})
    };
}

/**
 * Read an optional whole-number argument within a range.
 *
 * @param value - The raw argument, possibly absent.
 * @param field - The parameter name, for the message.
 * @param fallback - The value used when the argument is absent.
 * @param max - The largest accepted value.
 * @returns An integer from 1 to `max`.
 */
function readPositiveInteger(value: unknown, field: string, fallback: number, max: number): number {
    let result = fallback;
    if (value !== undefined && value !== null) {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
            throw new PageToolInputError(`${field} must be a whole number from 1 to ${max}.`);
        }
        result = value;
    }
    return result;
}

/**
 * Read the paging arguments shared by the list and search tools.
 *
 * @param input - The tool input.
 * @returns The 1-based page number, the page size, and the matching skip.
 */
function readPaging(input: Record<string, unknown>): { page: number; limit: number; skip: number } {
    const page = readPositiveInteger(input.page, 'page', 1, Number.MAX_SAFE_INTEGER);
    const limit = readPositiveInteger(input.limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT);

    return { page, limit, skip: (page - 1) * limit };
}

/**
 * Turn one `pages-get` identifier into the form the service accepts: a slug
 * starting with `/`, or a lower-cased content id.
 *
 * A full URL is accepted and reduced to its path, because a model is far more
 * likely to hold a link than an id. A trailing slash, query string, or
 * fragment is removed, since stored slugs carry none of them.
 *
 * @param value - One raw identifier from the model.
 * @returns The normalized slug or content id.
 */
function normalizeIdentifier(value: unknown): string {
    const text = typeof value === 'string' ? value.trim() : '';
    if (text.length === 0 || text.length > MAX_IDENTIFIER_LENGTH) {
        throw new PageToolInputError(`Each entry in pages must be a non-empty string of at most ${MAX_IDENTIFIER_LENGTH} characters.`);
    }

    let result: string;
    if (/^https?:\/\//i.test(text)) {
        let path: string;
        try {
            path = new URL(text).pathname;
        } catch {
            throw new PageToolInputError(`${JSON.stringify(text.slice(0, 80))} is not a valid URL.`);
        }
        result = path;
    } else if (text.startsWith('/')) {
        result = text.split(/[?#]/)[0];
    } else if (CONTENT_ID_PATTERN.test(text)) {
        result = text.toLowerCase();
    } else {
        throw new PageToolInputError(
            `${JSON.stringify(text.slice(0, 80))} is not a page id, slug, or URL. Use the id from ${AI_TOOL_NAMES.list} (a UUID), a slug starting with / such as "/about", or a full https URL.`
        );
    }

    if (result.startsWith('/') && result.length > 1) {
        result = result.replace(/\/+$/, '') || '/';
    }
    return result;
}

/**
 * Run one tool call, turning an input refusal into an answer the model can act
 * on and any other failure into a generic one that is logged in full.
 *
 * @param logger - Where unexpected failures are recorded.
 * @param toolName - The tool's name, for the log line.
 * @param body - The tool's work.
 * @returns `{ success: true, ... }`, or `{ success: false, error, errorKind }`.
 */
async function runPageTool(
    logger: ISystemLogService,
    toolName: string,
    body: () => Promise<Record<string, unknown>>
): Promise<Record<string, unknown>> {
    let response: Record<string, unknown>;
    try {
        response = { success: true, ...(await body()) };
    } catch (error) {
        if (error instanceof PageToolInputError) {
            response = { success: false, error: error.message, errorKind: 'input' };
        } else {
            logger.error({ error, tool: toolName }, 'Pages AI tool failed unexpectedly');
            response = { success: false, error: 'The page lookup failed. This is not caused by your input; retrying later may work.', errorKind: 'failed' };
        }
    }
    return response;
}

/**
 * Build the three tools against the page service.
 *
 * @param service - The page service the tools read through; it owns the rule
 *   that only published, visitor-visible pages are returned.
 * @param logger - Module-scoped logger for unexpected failures.
 * @returns The tools, in the order the admin page lists them.
 */
export function buildPageAiTools(service: IPageService, logger: ISystemLogService): IAiTool[] {
    /**
     * Run a list or search call through the service and shape the page of
     * results. Shared because the two tools differ only in the search text.
     *
     * @param input - The tool input, for the paging arguments.
     * @param search - The search text, or undefined to list everything.
     * @returns The summaries plus the paging fields both tools return.
     */
    const listSummaries = async (input: Record<string, unknown>, search?: string): Promise<Record<string, unknown>> => {
        const { page, limit, skip } = readPaging(input);
        const result = await service.listPublicPages({ ...(search ? { search } : {}), limit, skip });
        return {
            ...(search ? { query: search } : {}),
            total: result.total,
            page,
            limit,
            hasMore: skip + result.pages.length < result.total,
            pages: result.pages.map(toSummaryView)
        };
    };

    const list: IAiTool = {
        name: AI_TOOL_NAMES.list,
        description:
            'List the published site pages, most recently changed first, as short summaries without the body. ' +
            `Use to see which pages exist or to browse them; use ${AI_TOOL_NAMES.search} instead to find pages about a topic. ` +
            `Parameters: page (optional, 1-based, default 1); limit (optional, default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}). ` +
            'Returns total (every published page), page, limit, hasMore, and pages[] of { id, slug, title, description, keywords, updatedAt, excerpt }, where excerpt is a short plain-text opening of the body. ' +
            `Pass an id or slug to ${AI_TOOL_NAMES.get} to read a page in full. ` +
            SHARED_DESCRIPTION,
        capability: PAGE_READ_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Paging for the published-page list.',
            properties: {
                page: { type: 'integer', minimum: 1, description: '1-based page number. Default 1.' },
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Pages per call. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` }
            },
            additionalProperties: false
        },
        handler: async (input) => runPageTool(logger, AI_TOOL_NAMES.list, async () => listSummaries(input))
    };

    const search: IAiTool = {
        name: AI_TOOL_NAMES.search,
        description:
            'Search the published site pages for a text, most recently changed first, as short summaries without the body. ' +
            'The query is matched case-insensitively as a literal substring of each page\'s title, slug, description, keywords, and body. It is not a boolean or fuzzy search, so use a distinctive word or short phrase such as "energy rental", not a whole question. ' +
            `Use to find pages about a topic; use ${AI_TOOL_NAMES.list} to browse everything. ` +
            `Parameters: query (required, 1 to ${MAX_QUERY_LENGTH} characters); page (optional, 1-based, default 1); limit (optional, default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}). ` +
            'Returns query, total (every match), page, limit, hasMore, and pages[] of { id, slug, title, description, keywords, updatedAt, excerpt }. No matches returns an empty list, not an error. ' +
            `Pass an id or slug to ${AI_TOOL_NAMES.get} to read a page in full. ` +
            SHARED_DESCRIPTION,
        capability: PAGE_READ_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'Free-text search over published pages.',
            properties: {
                query: { type: 'string', description: `Text to find (1 to ${MAX_QUERY_LENGTH} characters), matched case-insensitively as a literal substring.` },
                page: { type: 'integer', minimum: 1, description: '1-based page number. Default 1.' },
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, description: `Pages per call. Default ${DEFAULT_LIMIT}, at most ${MAX_LIMIT}.` }
            },
            required: ['query'],
            additionalProperties: false
        },
        inputExamples: [
            { query: 'energy rental' },
            { query: 'staking', limit: 5 }
        ],
        handler: async (input) => runPageTool(logger, AI_TOOL_NAMES.search, async () => {
            const query = typeof input.query === 'string' ? input.query.trim() : '';
            if (query.length === 0 || query.length > MAX_QUERY_LENGTH) {
                throw new PageToolInputError(`query must be text of 1 to ${MAX_QUERY_LENGTH} characters.`);
            }
            return listSummaries(input, query);
        })
    };

    const get: IAiTool = {
        name: AI_TOOL_NAMES.get,
        description:
            'Read one or more published site pages in full, including the markdown body. ' +
            `Use after ${AI_TOOL_NAMES.list} or ${AI_TOOL_NAMES.search} to read the pages you picked, or directly when you already know a page's path or link. ` +
            `Parameters: pages (required, 1 to ${MAX_GET_PAGES} entries). Each entry is a page id from a list or search result (a UUID), a slug starting with / such as "/about", or a full URL to a page on the site, which is reduced to its path. ` +
            'A slug the page used to have still finds it, at its current slug. ' +
            'Returns pages[], one per entry in the order given, of { requested, found, page }. page is { id, slug, title, description, keywords, ogImage, updatedAt, markdown, truncated, totalCharacters } or null when no published page answers to the entry; null is a normal result, not an error. ' +
            `markdown is the body without its frontmatter, cut to ${MAX_BODY_CHARACTERS} characters, with truncated true and totalCharacters set when it was cut. ` +
            SHARED_DESCRIPTION,
        capability: PAGE_READ_CAPABILITY,
        inputSchema: {
            type: 'object',
            description: 'The pages to read.',
            properties: {
                pages: {
                    type: 'array',
                    items: { type: 'string', description: 'A page id (UUID), a slug starting with /, or a full URL to the page.' },
                    minItems: 1,
                    maxItems: MAX_GET_PAGES,
                    description: `1 to ${MAX_GET_PAGES} pages to read, by id, slug, or URL.`
                }
            },
            required: ['pages'],
            additionalProperties: false
        },
        inputExamples: [
            { pages: ['/about'] },
            { pages: ['3f2b8c1e-9d4a-4e7b-8a1c-5d6e7f809a1b', '/guides/energy-rental'] }
        ],
        handler: async (input) => runPageTool(logger, AI_TOOL_NAMES.get, async () => {
            if (!Array.isArray(input.pages) || input.pages.length === 0 || input.pages.length > MAX_GET_PAGES) {
                throw new PageToolInputError(`pages must be a list of 1 to ${MAX_GET_PAGES} page ids, slugs, or URLs.`);
            }
            const requested = input.pages.map((value) => (typeof value === 'string' ? value.trim() : ''));
            const identifiers = input.pages.map(normalizeIdentifier);
            const found = await service.getPublicPages(identifiers);
            return {
                pages: found.map((page, index) => ({
                    requested: requested[index],
                    found: page !== null,
                    page: page ? toFullView(page) : null
                }))
            };
        })
    };

    return [list, search, get];
}

/**
 * Register the page tools whenever the core `'ai-tools'` registry is available.
 *
 * The AI tools module publishes the registry in its own `run()` phase, which
 * comes after this module's, so the tools subscribe to its presence with
 * `watch()` rather than looking it up once. Each tool is unregistered before it
 * is registered, so the registry coming back does not trip the duplicate-name
 * guard. A failure is logged rather than thrown, because AI tooling is optional
 * and must not stop pages from being served.
 *
 * @param serviceRegistry - The registry to watch for `'ai-tools'`.
 * @param service - The page service the tools read through.
 * @param logger - Module-scoped logger.
 * @returns Disposer that removes the watch subscription.
 */
export function registerPageAiTools(
    serviceRegistry: IServiceRegistry,
    service: IPageService,
    logger: ISystemLogService
): ServiceWatchDisposer {
    const tools = buildPageAiTools(service, logger);

    return serviceRegistry.watch<IAiToolRegistry>('ai-tools', {
        onAvailable: (registry) => {
            for (const tool of tools) {
                try {
                    registry.unregisterTool(tool.name);
                    registry.registerTool(tool, PROVIDER_ID);
                } catch (error) {
                    logger.error({ error, tool: tool.name }, 'Failed to register a pages AI tool');
                }
            }
            logger.info({ tools: tools.map(tool => tool.name) }, 'Registered pages AI tools');
        }
    });
}
