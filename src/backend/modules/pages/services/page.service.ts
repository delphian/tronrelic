import type {
    ContentCurationState,
    IContent,
    IContentActor,
    IContentService,
    IPageService,
    IPage,
    IPageContent,
    IPageEditProposal,
    IPageEditProposalResult,
    IPageSettings,
    IPublicPage,
    IPublicPageRender,
    ICacheService,
    IDatabaseService,
    ISystemLogService,
    ITranslationValueStore,
} from '@/types';
import type {
    IPageDocument,
    IPageSettingsDocument,
} from '../database/index.js';
import { DEFAULT_PAGE_SETTINGS, PAGE_TRANSLATION_VALUES_COLLECTION } from '../database/index.js';
import { MarkdownService } from './markdown.service.js';
import { PageContentType, PAGE_CONTENT_TYPE_ID } from './page-content-type.js';
import type { IPageWriteInput } from './page-content-type.js';
import { PageTranslatable } from './page-translatable.js';
import { PageEditInputError } from './PageEditInputError.js';
import { ContentError } from '../../../services/content-error.js';
import { ObjectId } from 'mongodb';

/**
 * Longest body a proposed edit may carry, and the longest stored body it may
 * replace. Equal to what the `pages-get` AI tool returns per page, because a
 * caller can only safely replace a whole body it was able to read in full.
 */
export const MAX_PROPOSED_BODY_CHARACTERS = 20000;

/** Longest title a proposed edit may set. */
const MAX_PROPOSED_TITLE_LENGTH = 200;

/** Longest meta description a proposed edit may set. */
const MAX_PROPOSED_DESCRIPTION_LENGTH = 500;

/** Most keywords a proposed edit may set, and the longest each may be. */
const MAX_PROPOSED_KEYWORDS = 20;
const MAX_PROPOSED_KEYWORD_LENGTH = 64;

/** Longest social image URL a proposed edit may set. */
const MAX_PROPOSED_OG_IMAGE_LENGTH = 1024;

/** The fields of a proposed edit, checked and in the shape the stored frontmatter takes. */
interface IValidatedPageEdit {
    /** Frontmatter keys to set; a `null` value removes the key. */
    frontmatter: Record<string, unknown>;

    /** Replacement body, or undefined to keep the stored one. */
    body?: string;
}

/** Pages returned by `listPublicPages` when the caller does not say how many. */
const PUBLIC_LIST_DEFAULT_LIMIT = 20;

/** Most pages one `listPublicPages` call returns, whatever the caller asks for. */
const PUBLIC_LIST_MAX_LIMIT = 100;

/**
 * Turn an optional paging argument into a whole number within bounds.
 *
 * The public listing is reached from AI tools as well as code, so a missing,
 * fractional, or out-of-range value has to land somewhere safe rather than
 * reach the slice as `NaN` or a negative number.
 *
 * @param value - The caller's value, possibly absent or not a number.
 * @param fallback - Used when the value is absent or not a finite number.
 * @param min - The smallest value allowed.
 * @param max - The largest value allowed.
 * @returns A whole number from `min` to `max`.
 */
function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
    const whole = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;

    return Math.min(Math.max(whole, min), max);
}

/**
 * Whether a public page contains a search text anywhere a reader would see it.
 *
 * The match is a literal substring, so search text can never act as a regular
 * expression, and it covers the body without its frontmatter so the text
 * `published` does not match every page through its `published: true` line.
 *
 * @param page - The page to test.
 * @param needle - The search text, already trimmed and lower-cased.
 * @returns True when the title, slug, description, a keyword, or the body contains it.
 */
function publicPageContains(page: IPublicPage, needle: string): boolean {
    const haystacks = [page.title, page.slug, page.description, page.keywords.join(' '), page.body];

    return haystacks.some((text) => text.toLowerCase().includes(needle));
}

/**
 * Service for managing custom pages and page-only settings.
 *
 * Implements the `IPageService` contract. Pages are managed content
 * (`core:page`): every create, update, delete, and restore goes through the
 * core content service, and so does every public read — core decides which
 * pages a visitor may see and which version of each. This service keeps the
 * page-specific work: slug lookups, rendering, caching, admin listing, and the
 * route blacklist in page settings. The storage callbacks core invokes live in
 * `PageContentType`.
 *
 * Pages created before the adoption migration have no content id yet. Visitors
 * still see them by their own `published` flag, but they cannot be changed
 * until the migration adopts them.
 *
 * Singleton because `IPageService` is a public API with shared state:
 * configured once at bootstrap, consumed by all callers.
 */
export class PageService implements IPageService {
    private static instance: PageService;
    private readonly markdownService: MarkdownService;
    private readonly pagesCollection;
    private readonly settingsCollection;
    private readonly contentType: PageContentType;
    private readonly translationValues: ITranslationValueStore;

    /**
     * @param database - Core database holding `pages` and `page_settings`.
     * @param cacheService - Redis cache for rendered HTML.
     * @param contentService - The core content service every page operation
     *   and public read passes through.
     * @param logger - Scoped logger.
     * @param onPublicPagesChanged - Called after a change that can alter which
     *   page addresses visitors reach, so the localization snapshot that lists
     *   translated page addresses is rebuilt instead of naming a page that
     *   moved or went away.
     */
    private constructor(
        private readonly database: IDatabaseService,
        private readonly cacheService: ICacheService,
        private readonly contentService: IContentService,
        private readonly logger: ISystemLogService,
        private readonly onPublicPagesChanged: () => void
    ) {
        this.markdownService = new MarkdownService(cacheService);
        this.pagesCollection = database.getCollection<IPageDocument>('pages');
        this.settingsCollection = database.getCollection<IPageSettingsDocument>('page_settings');
        // Translated text stays in this module's storage; core hands out the
        // store and keeps each translation's state in its own collection.
        this.translationValues = contentService.translations().createValueStore(database, PAGE_TRANSLATION_VALUES_COLLECTION);
        this.contentType = new PageContentType(
            this.pagesCollection,
            this.markdownService,
            this,
            logger,
            onPublicPagesChanged,
            new PageTranslatable(
                this.translationValues,
                this.markdownService,
                /**
                 * Find the slugs whose render caches a translation change
                 * must drop.
                 *
                 * @param pageId - Core content id of the page.
                 * @returns The page's working and approved slugs.
                 */
                (pageId) => this.listSlugsForPage(pageId),
                logger
            )
        );
    }

    /**
     * Create the unique index the translation values collection relies on.
     * Called once from the module's `init()`; safe to repeat.
     *
     * @returns Resolves once the index exists.
     */
    async ensureTranslationIndexes(): Promise<void> {
        await this.translationValues.ensureIndexes();

        return;
    }

    /**
     * Configure the singleton. The first call wins.
     *
     * @param database - Core database.
     * @param cacheService - Redis cache service.
     * @param contentService - The core content service.
     * @param logger - Scoped logger.
     * @param onPublicPagesChanged - Called after a change that can alter which
     *   page addresses visitors reach. Defaults to doing nothing, for callers
     *   such as tests that have no localization snapshot to refresh.
     */
    public static setDependencies(
        database: IDatabaseService,
        cacheService: ICacheService,
        contentService: IContentService,
        logger: ISystemLogService,
        onPublicPagesChanged: () => void = () => undefined
    ): void {
        if (!PageService.instance) {
            PageService.instance = new PageService(database, cacheService, contentService, logger, onPublicPagesChanged);
        }
    }

    /**
     * Drop the singleton so each test builds a fresh service against its own
     * mocks.
     */
    public static resetForTests(): void {
        (PageService as unknown as { instance: PageService | undefined }).instance = undefined;
    }

    /**
     * Return the configured singleton.
     *
     * @returns The page service.
     * @throws When `setDependencies` has not run yet.
     */
    public static getInstance(): PageService {
        if (!PageService.instance) {
            throw new Error('PageService.setDependencies() must be called before getInstance()');
        }
        return PageService.instance;
    }

    /**
     * The `core:page` managed content type, for the pages module to register
     * on the core content service during `run()`.
     *
     * @returns The page content type.
     */
    getContentType(): PageContentType {
        return this.contentType;
    }

    // ============================================================================
    // Page Management (through the core content service)
    // ============================================================================

    /**
     * Create a page through the core content service.
     *
     * @param content - Markdown including frontmatter.
     * @param actor - Who is creating the page.
     * @returns The created page, latest edit.
     */
    async createPage(content: string, actor: IContentActor): Promise<IPage> {
        const input: IPageWriteInput = { content };
        const created = await this.contentService.create<IPageContent>(PAGE_CONTENT_TYPE_ID, input, actor);

        return this.toIPageFromContent(created);
    }

    /**
     * Change a page through the core content service.
     *
     * @param id - The page's core content id.
     * @param content - New markdown including frontmatter.
     * @param actor - Who is making the change.
     * @returns The changed page, latest edit.
     */
    async updatePage(id: string, content: string, actor: IContentActor): Promise<IPage> {
        const patch: IPageWriteInput = { content };
        const updated = await this.contentService.update<IPageContent>(PAGE_CONTENT_TYPE_ID, id, patch, actor);

        return this.toIPageFromContent(updated);
    }

    /**
     * Propose an edit to an existing page for human review. An automated
     * caller such as an AI tool must not be able to change what visitors read
     * without a person seeing it first, so the edit is always applied as a
     * non-curator: core compares the reviewed fields, holds the change in the
     * curation queue, and keeps serving the approved version until a curator
     * decides.
     *
     * A page is stored as one markdown string, so the edit is built from the
     * page's latest version: the changed frontmatter keys are laid over the
     * stored frontmatter, and every other key, including `published` and
     * `oldSlugs`, is kept as stored. The slug is written back explicitly,
     * because a page whose frontmatter has no slug takes its slug from the
     * title, and a retitle would otherwise move the page's address.
     *
     * A body replacement is refused when the stored body is longer than
     * `MAX_PROPOSED_BODY_CHARACTERS` or holds HTML comments or scripts. The
     * pages AI tools return neither in full, so a caller replacing the whole
     * body would silently delete text it never saw.
     *
     * @param pageId - The page's core content id.
     * @param input - The fields to change; at least one must be present.
     * @returns The page's id and slug, whether the edit waits for review, and
     *   the curation item id holding it.
     * @throws PageEditInputError when the input breaks a field rule or the
     *   stored body cannot be safely replaced.
     * @throws ContentError when the page is unknown, deleted, or vetoed, or
     *   curation is unavailable.
     */
    async proposeEdit(pageId: string, input: IPageEditProposal): Promise<IPageEditProposalResult> {
        const edit = this.validatePageEdit(input);
        const [current] = await this.contentService.readAdmin<IPageContent>(PAGE_CONTENT_TYPE_ID, [String(pageId)]);
        if (!current) {
            throw new ContentError('not-found', `No page has id ${pageId}`);
        }
        if (edit.body !== undefined) {
            this.assertBodyReplaceable(current.content);
        }
        const content = this.markdownService.editFrontmatter(
            current.content,
            { ...edit.frontmatter, slug: current.slug },
            edit.body
        );
        const actor: IContentActor = { id: `system:${input.source ?? 'pages-service'}`, kind: 'system', isCurator: false };
        // The write itself is updatePage's, so a page has exactly one method
        // that sends a change to core; this method only builds the markdown
        // and fixes the actor as a non-curator.
        const updated = await this.updatePage(current.id, content, actor);
        const pendingReview = updated.curation === 'pending';
        this.logger.info(
            { contentId: updated.contentId, pendingReview, curationId: updated.curationItemId },
            pendingReview ? 'Page edit proposed and held for curation' : 'Page edit proposed with no change to hold'
        );

        return { pageId: updated.contentId ?? current.id, slug: updated.slug, pendingReview, curationId: updated.curationItemId ?? '' };
    }

    /**
     * Check the fields of a proposed edit and turn them into frontmatter keys.
     *
     * The caller may be a model, and a JSON schema only suggests what it
     * sends, so every field is checked here for type, length, and shape. The
     * rules live in the service rather than in the tool so that any future
     * caller of `proposeEdit` gets the same ones.
     *
     * @param input - The fields the caller sent.
     * @returns The frontmatter keys to set and the replacement body, if any.
     * @throws PageEditInputError describing the first field that is wrong, or
     *   when no field was supplied.
     */
    private validatePageEdit(input: IPageEditProposal): IValidatedPageEdit {
        const frontmatter: Record<string, unknown> = {};
        let body: string | undefined;

        if (input.title !== undefined) {
            const title = typeof input.title === 'string' ? input.title.trim() : '';
            if (!title || title.length > MAX_PROPOSED_TITLE_LENGTH) {
                throw new PageEditInputError(`title must be text of 1 to ${MAX_PROPOSED_TITLE_LENGTH} characters.`);
            }
            frontmatter.title = title;
        }
        if (input.description !== undefined) {
            const description = typeof input.description === 'string' ? input.description.trim() : null;
            if (description === null || description.length > MAX_PROPOSED_DESCRIPTION_LENGTH) {
                throw new PageEditInputError(`description must be text of at most ${MAX_PROPOSED_DESCRIPTION_LENGTH} characters; an empty string clears it.`);
            }
            frontmatter.description = description || null;
        }
        if (input.keywords !== undefined) {
            frontmatter.keywords = this.validateKeywords(input.keywords);
        }
        if (input.ogImage !== undefined) {
            frontmatter.ogImage = this.validateOgImage(input.ogImage);
        }
        if (input.body !== undefined) {
            if (typeof input.body !== 'string' || !input.body.trim() || input.body.length > MAX_PROPOSED_BODY_CHARACTERS) {
                throw new PageEditInputError(`body must be markdown of 1 to ${MAX_PROPOSED_BODY_CHARACTERS} characters.`);
            }
            if (this.markdownService.hasFrontmatter(input.body)) {
                throw new PageEditInputError('body must not start with a frontmatter block; send only the markdown that follows it.');
            }
            body = input.body;
        }
        if (Object.keys(frontmatter).length === 0 && body === undefined) {
            throw new PageEditInputError('Provide at least one of title, body, description, keywords, or ogImage.');
        }

        return { frontmatter, body };
    }

    /**
     * Check a proposed keyword list. Keywords are page metadata shown to
     * search engines, so each must be short plain text, and duplicates are
     * dropped rather than refused.
     *
     * @param value - The list the caller sent.
     * @returns The trimmed keywords without duplicates.
     * @throws PageEditInputError when the value is not a list of short strings.
     */
    private validateKeywords(value: unknown): string[] {
        if (!Array.isArray(value) || value.length > MAX_PROPOSED_KEYWORDS) {
            throw new PageEditInputError(`keywords must be a list of at most ${MAX_PROPOSED_KEYWORDS} strings.`);
        }
        const keywords: string[] = [];
        for (const entry of value) {
            const keyword = typeof entry === 'string' ? entry.trim() : '';
            if (!keyword || keyword.length > MAX_PROPOSED_KEYWORD_LENGTH) {
                throw new PageEditInputError(`Each keyword must be text of 1 to ${MAX_PROPOSED_KEYWORD_LENGTH} characters.`);
            }
            if (!keywords.includes(keyword)) {
                keywords.push(keyword);
            }
        }

        return keywords;
    }

    /**
     * Check a proposed social image URL. The value lands in the page's
     * `og:image` tag, so it must be a path on this site or an https URL, never
     * another scheme or a protocol-relative address.
     *
     * @param value - The URL the caller sent; an empty string clears the image.
     * @returns The trimmed URL, or null to remove the image.
     * @throws PageEditInputError when the value is not an acceptable URL.
     */
    private validateOgImage(value: unknown): string | null {
        const url = typeof value === 'string' ? value.trim() : null;
        const acceptable = url !== null
            && url.length <= MAX_PROPOSED_OG_IMAGE_LENGTH
            && !/\s/.test(url)
            && (url === '' || /^\/(?!\/)/.test(url) || /^https:\/\/[^/]/i.test(url));
        if (!acceptable) {
            throw new PageEditInputError(
                `ogImage must be a path on this site starting with / or an https URL, at most ${MAX_PROPOSED_OG_IMAGE_LENGTH} characters; an empty string clears it.`
            );
        }

        return url || null;
    }

    /**
     * Refuse a whole-body replacement that would delete text the caller could
     * not have read. The pages AI tools cut bodies at
     * `MAX_PROPOSED_BODY_CHARACTERS` and strip HTML comments and scripts, so a
     * body that is longer, or that holds either, was never shown in full.
     *
     * @param content - The page's stored markdown, including frontmatter.
     * @throws PageEditInputError when the stored body cannot be safely replaced.
     */
    private assertBodyReplaceable(content: string): void {
        const { body } = this.markdownService.parseMarkdown(content);
        if (body.length > MAX_PROPOSED_BODY_CHARACTERS) {
            throw new PageEditInputError(
                `This page's body is longer than ${MAX_PROPOSED_BODY_CHARACTERS} characters, so it cannot be replaced through this path; ask an admin to edit it.`
            );
        }
        if (this.markdownService.stripHiddenMarkup(body) !== body) {
            throw new PageEditInputError(
                'This page\'s body holds HTML comments or scripts that the page tools do not show, so replacing it would delete them; ask an admin to edit it.'
            );
        }

        return;
    }

    /**
     * Soft-delete a page through the core content service.
     *
     * @param id - The page's core content id.
     * @param actor - Who is deleting the page.
     */
    async deletePage(id: string, actor: IContentActor): Promise<void> {
        await this.contentService.delete(PAGE_CONTENT_TYPE_ID, id, actor);
        // After core has marked its row, so a rebuild cannot still see the page.
        this.onPublicPagesChanged();
    }

    /**
     * Restore a soft-deleted page through the core content service.
     *
     * @param id - The page's core content id.
     * @param actor - Who is restoring the page.
     * @returns The restored page, latest edit.
     */
    async restorePage(id: string, actor: IContentActor): Promise<IPage> {
        const restored = await this.contentService.restore<IPageContent>(PAGE_CONTENT_TYPE_ID, id, actor);
        this.onPublicPagesChanged();

        return this.toIPageFromContent(restored);
    }

    /**
     * List the slugs a page is stored under: its latest edit's slug first,
     * then its approved version's when that differs. A translation is served
     * at its page's slug, so a translation change drops the render caches of
     * these addresses. Soft-deleted pages are included, because their caches
     * may still hold a render from before the deletion.
     *
     * @param pageId - The page's core content id.
     * @returns The slugs, empty when no page has that id.
     */
    async listSlugsForPage(pageId: string): Promise<string[]> {
        const doc = await this.pagesCollection.findOne({ contentId: pageId });
        const slugs = doc ? [doc.slug, doc.approved?.slug] : [];

        return Array.from(new Set(slugs.filter((slug): slug is string => Boolean(slug))));
    }

    /**
     * Get a page's latest edit for the admin editor.
     *
     * @param id - The page's core content id.
     * @returns The page, or null when none has that id.
     */
    async getPageById(id: string): Promise<IPage | null> {
        const [page] = await this.contentService.readAdmin<IPageContent>(PAGE_CONTENT_TYPE_ID, [id]);

        return page ? this.toIPageFromContent(page) : null;
    }

    /**
     * Get the page a visitor sees at a slug.
     *
     * @param slug - The requested path.
     * @returns The visible, published page served at that slug, or null.
     */
    async getPublicPageBySlug(slug: string): Promise<IPage | null> {
        return this.resolvePublic(
            { $or: [{ slug }, { 'approved.slug': slug }] },
            (page) => page.slug === slug
        );
    }

    /**
     * Find the visible page whose served redirect history contains a slug.
     *
     * @param oldSlug - The requested path.
     * @returns The page to redirect to, or null.
     */
    async findPublicPageByOldSlug(oldSlug: string): Promise<IPage | null> {
        return this.resolvePublic(
            { $or: [{ oldSlugs: oldSlug }, { 'approved.oldSlugs': oldSlug }] },
            (page) => page.oldSlugs.includes(oldSlug)
        );
    }

    /**
     * List pages for the admin view, latest edits, newest first. A review-state
     * filter asks core for the matching ids first, since review state lives
     * only in core's collection.
     *
     * @param options - Filters and paging.
     * @returns The matching pages, decorated with review state.
     */
    async listPages(
        options: {
            published?: boolean;
            search?: string;
            curation?: ContentCurationState;
            deleted?: boolean;
            limit?: number;
            skip?: number;
        } = {}
    ): Promise<IPage[]> {
        const { published, search, curation, deleted = false, limit = 50, skip = 0 } = options;

        // `{ deletedAt: null }` matches both a null marker and a document that
        // predates the field, which is exactly "live".
        const query: Record<string, unknown> = deleted
            ? { deletedAt: { $ne: null } }
            : { deletedAt: null };

        if (published !== undefined) {
            query.published = published;
        }

        if (search) {
            query.$text = { $search: search };
        }

        if (curation !== undefined) {
            query.contentId = { $in: await this.listContentIds(curation, deleted) };
        }

        const docs = await this.pagesCollection
            .find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .skip(skip)
            .toArray();

        return this.decorate(docs);
    }

    /**
     * Count pages for the admin summary. Published and draft counts describe
     * the latest edits of live pages; review and deletion counts come from core.
     *
     * @returns The page counts.
     */
    async getPageStats(): Promise<{
        total: number;
        published: number;
        drafts: number;
        pendingReview: number;
        deleted: number;
    }> {
        const [total, published, pendingReview, deleted] = await Promise.all([
            this.pagesCollection.countDocuments({ deletedAt: null }),
            this.pagesCollection.countDocuments({ deletedAt: null, published: true }),
            this.contentService.count({ typeId: PAGE_CONTENT_TYPE_ID, curation: 'pending' }),
            this.pagesCollection.countDocuments({ deletedAt: { $ne: null } }),
        ]);

        return {
            total,
            published,
            drafts: total - published,
            pendingReview,
            deleted,
        };
    }

    /**
     * Every page a visitor can reach, for the sitemap. Managed pages are
     * resolved through core so a page with only a pending or rejected edit,
     * or a deleted page, never appears.
     *
     * @returns One `{ slug, updatedAt }` per reachable page.
     */
    async listSitemapPages(): Promise<Array<{ slug: string; updatedAt: string }>> {
        const pages = await this.loadVisiblePages();

        return pages.map((page) => ({
            slug: page.slug,
            updatedAt: new Date(page.updatedAt ?? Date.now()).toISOString()
        }));
    }

    /**
     * List the published pages a visitor can reach, most recently changed
     * first, optionally filtered by a literal search.
     *
     * Every visible page is loaded and then filtered in memory, rather than
     * asking MongoDB to search. The collection stores two versions of each
     * page (the latest edit and the approved snapshot), and only core knows
     * which one a visitor is served, so a database query against either
     * field set could match text a visitor never sees. The CMS holds tens of
     * pages, not thousands, so the full load is cheap.
     *
     * @param options - `search` text, and `limit`/`skip` paging, all optional.
     * @returns The page of results and the total number of matches.
     */
    async listPublicPages(
        options: { search?: string; limit?: number; skip?: number } = {}
    ): Promise<{ pages: IPublicPage[]; total: number }> {
        const limit = clampInteger(options.limit, PUBLIC_LIST_DEFAULT_LIMIT, 1, PUBLIC_LIST_MAX_LIMIT);
        const skip = clampInteger(options.skip, 0, 0, Number.MAX_SAFE_INTEGER);
        const needle = (options.search ?? '').trim().toLowerCase();

        const visible = (await this.loadVisiblePages()).map((page) => this.toPublicPage(page));
        const matches = needle
            ? visible.filter((page) => publicPageContains(page, needle))
            : visible;
        matches.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.slug.localeCompare(b.slug));

        return { pages: matches.slice(skip, skip + limit), total: matches.length };
    }

    /**
     * Read published pages in full by content id or slug.
     *
     * Slugs go through the same lookups the public page route uses, current
     * slug first and redirect history second, so a caller holding an old URL
     * reaches the page a visitor would be redirected to. Content ids are read
     * through core in one batch. Either way the page must be published on the
     * version core serves, which is the rule that keeps drafts and held edits
     * out of every public read.
     *
     * @param identifiers - Content ids or slugs starting with `/`.
     * @returns One entry per identifier, in order, null where nothing published answers.
     */
    async getPublicPages(identifiers: ReadonlyArray<string>): Promise<Array<IPublicPage | null>> {
        const ids = identifiers.filter((identifier) => !identifier.startsWith('/'));
        const byId = new Map<string, IPage>();
        if (ids.length > 0) {
            const served = await this.contentService.readPublic<IPageContent>(PAGE_CONTENT_TYPE_ID, ids);
            for (const page of served) {
                if (page.published) {
                    byId.set(page.id, this.toIPageFromContent(page));
                }
            }
        }

        const pages = await Promise.all(identifiers.map(async (identifier) => {
            const page = identifier.startsWith('/')
                ? (await this.getPublicPageBySlug(identifier)) ?? (await this.findPublicPageByOldSlug(identifier))
                : byId.get(identifier) ?? null;
            return page ? this.toPublicPage(page) : null;
        }));

        return pages;
    }

    // ============================================================================
    // Markdown Rendering
    // ============================================================================

    /**
     * Render a page's markdown to HTML, with Redis caching.
     *
     * @param page - The page to render.
     * @returns Sanitized HTML.
     */
    async renderPageHtml(page: IPage): Promise<string> {
        const cached = await this.markdownService.getCachedHtml(page.slug);
        if (cached) {
            return cached;
        }

        const { body } = this.markdownService.parseMarkdown(page.content);
        const html = await this.markdownService.renderMarkdown(body);
        await this.markdownService.cacheHtml(page.slug, html);

        return html;
    }

    /**
     * Drop the render caches for a page's slug.
     *
     * @param page - The page whose caches to drop.
     */
    async invalidatePageCache(page: IPage): Promise<void> {
        await this.markdownService.invalidateAllCaches(page.slug);
    }

    /**
     * Render markdown for the live editor preview without saving it.
     *
     * @param content - Markdown including frontmatter.
     * @returns The HTML and the parsed metadata.
     */
    async previewMarkdown(
        content: string
    ): Promise<{
        html: string;
        metadata: {
            title?: string;
            description?: string;
            keywords?: string[];
            ogImage?: string;
        };
    }> {
        const { frontmatter, body } = this.markdownService.parseMarkdown(content);
        const html = await this.markdownService.renderMarkdown(body);

        return {
            html,
            metadata: {
                title: frontmatter.title,
                description: frontmatter.description,
                keywords: frontmatter.keywords,
                ogImage: frontmatter.ogImage,
            },
        };
    }

    /**
     * Render the page a visitor sees at a slug. The cache is keyed by slug and
     * dropped by every storage step that could change what a slug serves.
     * A render that resolved the page just before such a step can still write
     * the old version back afterwards, because the cache has no
     * compare-and-set. That stale entry lasts until the next change to the
     * page or the cache TTL.
     *
     * @param slug - The requested path.
     * @returns The render, or null when no visible, published page is served there.
     */
    async renderPublicPageBySlug(slug: string): Promise<IPublicPageRender | null> {
        const cached = await this.markdownService.getCachedRender(slug);
        if (cached) {
            return cached;
        }

        const page = await this.getPublicPageBySlug(slug);
        let response: IPublicPageRender | null = null;
        if (page) {
            const { body } = this.markdownService.parseMarkdown(page.content);
            const html = await this.markdownService.renderMarkdown(body);
            response = {
                html,
                metadata: {
                    title: page.title,
                    description: page.description,
                    keywords: page.keywords,
                    ogImage: page.ogImage || undefined,
                },
            };
            await this.markdownService.cacheRender(slug, html, response.metadata);
        }

        return response;
    }

    // ============================================================================
    // Settings Management
    // ============================================================================

    /**
     * Read page settings, seeding defaults on first use.
     *
     * @returns The settings.
     */
    async getSettings(): Promise<IPageSettings> {
        let settings = await this.settingsCollection.findOne({});

        if (!settings) {
            settings = {
                _id: new ObjectId(),
                ...DEFAULT_PAGE_SETTINGS,
                updatedAt: new Date(),
            };
            await this.settingsCollection.insertOne(settings);
            this.logger.info('Created default page settings');
        }

        return this.toIPageSettings(settings);
    }

    /**
     * Apply a partial settings update.
     *
     * @param updates - The fields to change.
     * @returns The merged settings.
     */
    async updateSettings(updates: Partial<IPageSettings>): Promise<IPageSettings> {
        let settings = await this.settingsCollection.findOne({});

        if (!settings) {
            settings = {
                _id: new ObjectId(),
                ...DEFAULT_PAGE_SETTINGS,
                updatedAt: new Date(),
            };
            await this.settingsCollection.insertOne(settings);
        }

        const updateDoc: Record<string, unknown> = { updatedAt: new Date() };

        if (updates.blacklistedRoutes !== undefined) {
            updateDoc.blacklistedRoutes = updates.blacklistedRoutes;
        }

        await this.settingsCollection.updateOne({ _id: settings._id }, { $set: updateDoc });

        this.logger.info('Updated page settings');

        const updatedSettings = await this.settingsCollection.findOne({ _id: settings._id });
        if (!updatedSettings) {
            throw new Error('Failed to retrieve updated settings');
        }

        return this.toIPageSettings(updatedSettings);
    }

    // ============================================================================
    // Slug Utilities
    // ============================================================================

    /**
     * Normalize raw text into a valid slug.
     *
     * @param input - The slug or title to normalize.
     * @returns The sanitized slug, always starting with `/`.
     */
    sanitizeSlug(input: string): string {
        let slug = input.toLowerCase();

        slug = slug.replace(/\s+/g, '-');
        slug = slug.replace(/[^a-z0-9-/]/g, '');
        slug = slug.replace(/-+/g, '-');
        slug = slug.replace(/^-+|-+$/g, '');

        if (!slug.startsWith('/')) {
            slug = '/' + slug;
        }

        return slug;
    }

    /**
     * Whether a slug matches a blacklisted route pattern from settings.
     *
     * @param slug - The sanitized slug.
     * @returns True when the slug may not be used.
     */
    async isSlugBlacklisted(slug: string): Promise<boolean> {
        const settings = await this.getSettings();

        for (const pattern of settings.blacklistedRoutes) {
            const regex = new RegExp(pattern);
            if (regex.test(slug)) {
                return true;
            }
        }

        return false;
    }

    // ============================================================================
    // Private Helpers
    // ============================================================================

    /**
     * Find the one visible, published page a public request resolves to.
     * Candidates come from the pages collection (by working or approved slug);
     * managed candidates are then filtered and versioned by core, and the match
     * is tested against the version core serves. A page the migration has not
     * adopted yet is judged by its own `published` flag and deletion marker.
     *
     * @param filter - Finds candidate documents by working or approved slug.
     * @param matches - Tests a served page against the requested slug.
     * @returns The visible page, or null.
     */
    private async resolvePublic(
        filter: Record<string, unknown>,
        matches: (page: IPage) => boolean
    ): Promise<IPage | null> {
        const docs = await this.pagesCollection.find(filter).toArray();
        const legacy = docs
            .filter((doc) => !doc.contentId && !doc.deletedAt && doc.published)
            .map((doc) => this.toIPage(doc));
        const managedIds = docs.filter((doc) => doc.contentId).map((doc) => doc.contentId as string);
        const served = await this.contentService.readPublic<IPageContent>(PAGE_CONTENT_TYPE_ID, managedIds);
        const candidates = [...served.map((page) => this.toIPageFromContent(page)), ...legacy];

        return candidates.find((page) => page.published && matches(page)) ?? null;
    }

    /**
     * Load every page a visitor can reach, at the version core serves.
     *
     * Shared by the sitemap and the public listing so both apply the same
     * visibility rule: managed pages are resolved through core, which drops
     * deleted pages and pages whose only version is waiting for review, and
     * the served version must be published. A page the adoption migration has
     * not reached is judged by its own `published` flag.
     *
     * @returns The visible pages, in no particular order.
     */
    private async loadVisiblePages(): Promise<IPage[]> {
        const docs = await this.pagesCollection.find({ deletedAt: null }).toArray();
        const legacy = docs
            .filter((doc) => !doc.contentId && doc.published)
            .map((doc) => this.toIPage(doc));
        const managedIds = docs.filter((doc) => doc.contentId).map((doc) => doc.contentId as string);
        const served = await this.contentService.readPublic<IPageContent>(PAGE_CONTENT_TYPE_ID, managedIds);
        const managed = served
            .filter((page) => page.published)
            .map((page) => this.toIPageFromContent(page));

        return [...managed, ...legacy];
    }

    /**
     * Reduce a visible page to what a reader of its content needs.
     *
     * The frontmatter is stripped from the body because every field it holds
     * is already returned on its own, and the review and redirect fields are
     * dropped because they describe the admin workflow, not the page. HTML
     * comments and scripts are removed because the renderer hides them from
     * visitors, and an author may have left a private note in a comment.
     *
     * @param page - A page already known to be visible and published.
     * @returns The public view of the page.
     */
    private toPublicPage(page: IPage): IPublicPage {
        const body = this.markdownService.stripHiddenMarkup(this.markdownService.parseMarkdown(page.content).body);

        return {
            id: page.contentId ?? null,
            slug: page.slug,
            title: page.title,
            description: page.description ?? '',
            keywords: page.keywords ?? [],
            ...(page.ogImage ? { ogImage: page.ogImage } : {}),
            body,
            updatedAt: new Date(page.updatedAt ?? Date.now()),
        };
    }

    /**
     * Collect every page content id in one review state. Core caps a single
     * `list` call at 500 rows, so taking only the first batch would silently
     * drop the remaining pages from a review-state filter. This pages through
     * core until a batch comes back empty. Stopping on an empty batch rather
     * than a short one keeps the loop correct even if core lowers its cap
     * below the batch size requested here.
     *
     * @param curation - The review state the admin list is filtered by.
     * @param deleted - Whether the admin is viewing live or soft-deleted pages,
     *   so the ids come from the same side of the deletion filter.
     * @returns The content id of every matching page.
     */
    private async listContentIds(curation: ContentCurationState, deleted: boolean): Promise<string[]> {
        const batchSize = 500;
        const ids: string[] = [];
        let batch: IContent[];
        do {
            batch = await this.contentService.list({
                typeId: PAGE_CONTENT_TYPE_ID,
                curation,
                deleted,
                limit: batchSize,
                skip: ids.length
            });
            ids.push(...batch.map((entry) => entry.id));
        } while (batch.length > 0);

        return ids;
    }

    /**
     * Attach core review and deletion state to raw page documents for the
     * admin list.
     *
     * @param docs - Page documents, latest edits.
     * @returns The pages, decorated where a core row exists.
     */
    private async decorate(docs: IPageDocument[]): Promise<IPage[]> {
        const ids = docs.filter((doc) => doc.contentId).map((doc) => doc.contentId as string);
        const entries = ids.length > 0 ? await this.contentService.getEntries(PAGE_CONTENT_TYPE_ID, ids) : {};

        return docs.map((doc) => {
            const entry: IContent | undefined = doc.contentId ? entries[doc.contentId] : undefined;
            return { ...this.toIPage(doc), ...this.managedFields(entry) };
        });
    }

    /**
     * The review and deletion fields `IPage` carries, taken from a core row.
     *
     * @param entry - The core row, or undefined for an unadopted page.
     * @returns The fields to spread onto the page.
     */
    private managedFields(entry: IContent | undefined): Partial<IPage> {
        return entry
            ? {
                contentId: entry.id,
                curation: entry.curation,
                hasApprovedVersion: entry.hasApprovedVersion,
                deletedAt: entry.deletedAt,
            }
            : {};
    }

    /**
     * Map a raw page document to the API shape, latest edit.
     *
     * @param doc - The page document.
     * @returns The page.
     */
    private toIPage(doc: IPageDocument): IPage {
        return {
            _id: doc._id.toString(),
            contentId: doc.contentId,
            title: doc.title,
            slug: doc.slug,
            oldSlugs: doc.oldSlugs || [],
            content: doc.content,
            description: doc.description,
            keywords: doc.keywords,
            published: doc.published,
            ogImage: doc.ogImage || undefined,
            authorId: doc.authorId,
            deletedAt: doc.deletedAt ?? undefined,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
        };
    }

    /**
     * Map a page read through core to the API shape.
     *
     * @param page - The merged core row and page fields.
     * @returns The page.
     */
    private toIPageFromContent(page: IPageContent): IPage {
        return {
            contentId: page.id,
            title: page.title,
            slug: page.slug,
            oldSlugs: page.oldSlugs,
            content: page.content,
            description: page.description,
            keywords: page.keywords,
            published: page.published,
            ogImage: page.ogImage,
            authorId: page.authorId,
            curation: page.curation,
            curationItemId: page.curationItemId,
            hasApprovedVersion: page.hasApprovedVersion,
            deletedAt: page.deletedAt,
            createdAt: page.createdAt,
            updatedAt: page.updatedAt,
        };
    }

    /**
     * Map a settings document to the API shape.
     *
     * @param doc - The settings document.
     * @returns The settings.
     */
    private toIPageSettings(doc: IPageSettingsDocument): IPageSettings {
        return {
            _id: doc._id.toString(),
            blacklistedRoutes: doc.blacklistedRoutes,
            updatedAt: doc.updatedAt,
        };
    }
}
