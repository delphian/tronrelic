/**
 * @fileoverview The `core:page` managed content type — the storage side of
 * pages under the core content service.
 *
 * The core content service calls these methods after it has run the veto
 * hooks, recorded the actor, and decided the review state. This type owns only
 * what is specific to pages: parsing frontmatter, validating and reserving
 * slugs, and keeping two versions of every page in the `pages` collection — the
 * latest edit in the document's top-level fields, and the approved version in
 * its `approved` snapshot. Visitors are served the snapshot while a newer edit
 * waits for review.
 *
 * Nothing outside the core content service calls these methods. The page
 * service reaches them only through `IContentService`, which is what makes the
 * hooks, the audit, and curation impossible to skip for a page.
 *
 * Soft deletion never frees a slug. Every slug and redirect check below reads
 * deleted pages too, so a deleted page's URLs stay reserved until a purge
 * exists and a restore can never collide. The one removal is `discardCreate`,
 * which undoes a create that never finished.
 *
 * @module backend/modules/pages/services/page-content-type
 */

import { ObjectId } from 'mongodb';
import type { Collection } from 'mongodb';
import type {
    ContentPayload,
    IContentDescriptor,
    IContentDescriptorField,
    IContentReadRequest,
    IManagedContentType,
    IPageContent,
    ISystemLogService
} from '@/types';
import type { IPageDocument, IPageVersionDocument } from '../database/index.js';
import type { MarkdownService } from './markdown.service.js';

/** Namespaced id of the page content type. */
export const PAGE_CONTENT_TYPE_ID = 'core:page';

/** What a caller supplies to create or change a page: the full markdown. */
export interface IPageWriteInput {
    /** Markdown including the frontmatter block. */
    content: string;
}

/**
 * The slug rules the page service owns — sanitizing and the route blacklist
 * held in page settings. Passed in so the type reuses the service's rules
 * rather than keeping a second copy.
 */
export interface IPageSlugPolicy {
    /**
     * Normalize raw text into a valid slug.
     *
     * @param input - The slug or title to normalize.
     * @returns The sanitized slug.
     */
    sanitizeSlug(input: string): string;

    /**
     * Whether a slug matches a blacklisted route pattern.
     *
     * @param slug - The sanitized slug.
     * @returns True when the slug may not be used.
     */
    isSlugBlacklisted(slug: string): Promise<boolean>;
}

/**
 * The fields parsed out of a page's markdown on every write.
 */
interface IParsedPageFields {
    title: string;
    slug: string;
    oldSlugs: string[];
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
}

/**
 * Storage for the `core:page` managed content type.
 */
export class PageContentType implements IManagedContentType<IPageContent, IPageWriteInput, IPageWriteInput> {
    readonly typeId = PAGE_CONTENT_TYPE_ID;
    readonly label = 'Page';

    /**
     * Pages are public, but only on this platform: no external publish sink is
     * ever offered for a page.
     */
    readonly classification = { egress: 'user', audience: 'public' } as const;

    /**
     * Everything a visitor or a search engine sees. `content` covers the body,
     * and the parsed frontmatter fields are listed too so a reviewer's view of
     * what changed matches what the page will publish.
     */
    readonly reviewedFields = ['content', 'title', 'description', 'keywords', 'slug', 'ogImage', 'published'] as const;

    /**
     * @param pages - The `pages` collection.
     * @param markdown - Parses frontmatter and owns the render caches.
     * @param slugPolicy - The page service's slug rules.
     * @param logger - Scoped logger for storage diagnostics.
     */
    constructor(
        private readonly pages: Collection<IPageDocument>,
        private readonly markdown: MarkdownService,
        private readonly slugPolicy: IPageSlugPolicy,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Render a page's latest edit for the curation queue: the markdown body,
     * the hero image, and every frontmatter field a visitor will see.
     *
     * @param ref - `{ id }`, the core content id.
     * @returns The descriptor the queue renders.
     */
    async describe(ref: Record<string, unknown>): Promise<IContentDescriptor> {
        const doc = await this.findByContentId(String(ref.id ?? ''));
        let descriptor: IContentDescriptor = {
            title: 'Page (unavailable)',
            body: '',
            details: [{ label: 'Status', value: 'The underlying page no longer exists.' }]
        };
        if (doc) {
            const { body } = this.markdown.parseMarkdown(doc.content);
            const details: IContentDescriptorField[] = [
                { label: 'Slug', value: doc.slug },
                { label: 'Published', value: doc.published ? 'Yes' : 'No' },
                ...(doc.approved && doc.approved.slug !== doc.slug
                    ? [{ label: 'Currently live at', value: doc.approved.slug }]
                    : []),
                ...(doc.description ? [{ label: 'Description', value: doc.description }] : []),
                ...(doc.keywords.length > 0 ? [{ label: 'Keywords', value: doc.keywords.join(', ') }] : []),
                ...(doc.ogImage ? [{ label: 'Social image', value: doc.ogImage }] : [])
            ];
            descriptor = {
                title: doc.title,
                body,
                ...(doc.ogImage ? { media: [{ url: doc.ogImage, kind: 'image' as const, alt: doc.title }] } : {}),
                details,
                editable: false
            };
        }

        return descriptor;
    }

    /**
     * Store a new page under the core-issued id. Nothing is approved here —
     * the content service calls `approve` when the creator is a curator.
     *
     * @param id - The core content id.
     * @param input - The page markdown.
     * @throws Error when the frontmatter or slug is invalid.
     */
    async create(id: string, input: IPageWriteInput): Promise<void> {
        const content = this.requireContent(input);
        const fields = this.parseFields(content);
        await this.assertSlugsAvailable(fields.slug, fields.oldSlugs, null, true);

        const now = new Date();
        const doc: IPageDocument = {
            _id: new ObjectId(),
            contentId: id,
            deletedAt: null,
            approved: null,
            ...fields,
            content,
            authorId: null,
            createdAt: now,
            updatedAt: now
        };
        await this.pages.insertOne(doc);
        this.logger.info({ contentId: id, slug: doc.slug }, `Created page: ${doc.title}`);

        return;
    }

    /**
     * Remove a page whose create core could not finish, which frees its slug
     * and redirect history for a retry. Core calls this only for a create
     * still in progress, so this never removes a page anyone was told exists.
     * The render cache is dropped too, because a curator's new page is served
     * at its working version for the moment before approval fails.
     *
     * @param id - The core content id issued for the abandoned create.
     */
    async discardCreate(id: string): Promise<void> {
        const doc = await this.findByContentId(id);
        if (doc) {
            await this.pages.deleteOne({ _id: doc._id });
            await this.invalidate(doc.slug);
            this.logger.info({ contentId: id, slug: doc.slug }, `Discarded unfinished page create: ${doc.title}`);
        }

        return;
    }

    /**
     * Load pages at the versions core asks for. A request for the approved
     * version of a page that has none is omitted.
     *
     * @param requests - The ids and versions to load.
     * @returns Each found page's fields, keyed by content id.
     */
    async read(requests: ReadonlyArray<IContentReadRequest>): Promise<Record<string, ContentPayload<IPageContent>>> {
        const ids = requests.map((request) => request.id);
        const docs = ids.length > 0 ? await this.pages.find({ contentId: { $in: ids } }).toArray() : [];
        const byId = new Map(docs.map((doc) => [doc.contentId as string, doc]));
        const result: Record<string, ContentPayload<IPageContent>> = {};
        for (const request of requests) {
            const doc = byId.get(request.id);
            if (doc && request.version === 'working') {
                result[request.id] = this.toPayload(doc, doc);
            } else if (doc && request.version === 'approved' && doc.approved) {
                result[request.id] = this.toPayload(doc.approved, doc);
            }
        }

        return result;
    }

    /**
     * Replace a page's latest edit. When the slug changes, the previous slug
     * joins the redirect history so old links keep working. The approved
     * snapshot is never touched here.
     *
     * @param id - The core content id.
     * @param patch - The new markdown.
     * @throws Error when the page is missing or the frontmatter or slug is invalid.
     */
    async update(id: string, patch: IPageWriteInput): Promise<void> {
        const doc = await this.requireByContentId(id);
        const content = this.requireContent(patch);
        const fields = this.parseFields(content, (slug) => this.inheritedOldSlugs(doc, slug));
        const slugChanged = fields.slug !== doc.slug;
        await this.assertSlugsAvailable(fields.slug, fields.oldSlugs, doc._id, slugChanged);

        const oldSlugs = slugChanged && !fields.oldSlugs.includes(doc.slug)
            ? [...fields.oldSlugs, doc.slug]
            : fields.oldSlugs;
        await this.pages.updateOne(
            { _id: doc._id },
            { $set: { ...fields, oldSlugs, content, updatedAt: new Date() } }
        );
        await this.invalidate(doc.slug, fields.slug, doc.approved?.slug);
        this.logger.info({ contentId: id, slug: fields.slug }, `Updated page: ${fields.title}`);

        return;
    }

    /**
     * Soft-delete a page. The document stays, and its slugs stay reserved.
     *
     * @param id - The core content id.
     */
    async delete(id: string): Promise<void> {
        const doc = await this.requireByContentId(id);
        await this.pages.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } });
        await this.invalidate(doc.slug, doc.approved?.slug);
        this.logger.info({ contentId: id, slug: doc.slug }, `Soft-deleted page: ${doc.title}`);

        return;
    }

    /**
     * Bring a soft-deleted page back. Its slugs were reserved the whole time,
     * so there is nothing that can collide.
     *
     * @param id - The core content id.
     */
    async restore(id: string): Promise<void> {
        const doc = await this.requireByContentId(id);
        await this.pages.updateOne({ _id: doc._id }, { $set: { deletedAt: null } });
        await this.invalidate(doc.slug, doc.approved?.slug);
        this.logger.info({ contentId: id, slug: doc.slug }, `Restored page: ${doc.title}`);

        return;
    }

    /**
     * Copy the latest edit into the approved snapshot, so visitors start
     * seeing it. Safe to repeat — the second call copies the same fields.
     *
     * @param id - The core content id.
     */
    async approve(id: string): Promise<void> {
        const doc = await this.requireByContentId(id);
        const approved: IPageVersionDocument = {
            title: doc.title,
            slug: doc.slug,
            oldSlugs: doc.oldSlugs ?? [],
            content: doc.content,
            description: doc.description,
            keywords: doc.keywords,
            published: doc.published,
            ogImage: doc.ogImage,
            approvedAt: new Date()
        };
        await this.pages.updateOne({ _id: doc._id }, { $set: { approved } });
        await this.invalidate(doc.slug, doc.approved?.slug);

        return;
    }

    // ---------------------------------------------------------------- internals

    /**
     * Find a page document by its core content id.
     *
     * @param id - The core content id.
     * @returns The document, or null.
     */
    private async findByContentId(id: string): Promise<IPageDocument | null> {
        return this.pages.findOne({ contentId: String(id) });
    }

    /**
     * Find a page document the content service expects to exist.
     *
     * @param id - The core content id.
     * @returns The document.
     * @throws Error when no page carries that content id.
     */
    private async requireByContentId(id: string): Promise<IPageDocument> {
        const doc = await this.findByContentId(id);
        if (!doc) {
            throw new Error(`Page with content id ${id} not found`);
        }

        return doc;
    }

    /**
     * Pull the markdown out of a write input.
     *
     * @param input - The caller's input.
     * @returns The markdown.
     * @throws Error when it is missing or blank.
     */
    private requireContent(input: IPageWriteInput): string {
        const content = typeof input?.content === 'string' ? input.content : '';
        if (!content.trim()) {
            throw new Error('Content is required');
        }

        return content;
    }

    /**
     * Work out the redirect history an update keeps when its frontmatter does
     * not declare one. A held rename adds the live slug to the history before
     * a curator has approved it. If that rename is rejected, the page is still
     * live at that slug, so an edit that moves it back must not be refused as
     * a redirect loop. The live slug is therefore dropped from the inherited
     * history when the edit targets it, and kept otherwise so the redirect
     * survives a rename that does go live.
     *
     * @param doc - The page being updated, supplying its history and the slug
     *   of its approved (live) version.
     * @param targetSlug - The sanitized slug the new markdown asks for.
     * @returns The history to fall back to when the frontmatter has none.
     */
    private inheritedOldSlugs(doc: IPageDocument, targetSlug: string): string[] {
        const history = doc.oldSlugs ?? [];
        const liveSlug = doc.approved?.slug;

        return liveSlug && targetSlug === liveSlug
            ? history.filter((slug) => slug !== liveSlug)
            : history;
    }

    /**
     * Parse the frontmatter into the stored page fields.
     *
     * @param content - Markdown including frontmatter.
     * @param fallbackOldSlugs - Produces the redirect history to keep when the
     *   frontmatter does not declare one, given the parsed slug (an update
     *   keeps the page's existing history, adjusted for the slug it targets).
     * @returns The parsed fields.
     * @throws Error when the frontmatter has no title.
     */
    private parseFields(
        content: string,
        fallbackOldSlugs: (slug: string) => string[] = () => []
    ): IParsedPageFields {
        const { frontmatter } = this.markdown.parseMarkdown(content);
        if (!frontmatter.title) {
            throw new Error('Frontmatter must include a title field');
        }
        const slug = this.slugPolicy.sanitizeSlug(frontmatter.slug || frontmatter.title);

        return {
            title: frontmatter.title,
            slug,
            oldSlugs: frontmatter.oldSlugs || fallbackOldSlugs(slug),
            description: frontmatter.description || '',
            keywords: frontmatter.keywords || [],
            published: frontmatter.published || false,
            ogImage: frontmatter.ogImage || null
        };
    }

    /**
     * Check a slug and its redirect history against every other page,
     * including soft-deleted ones and approved snapshots, so a page can never
     * take a URL another page holds or will serve.
     *
     * @param slug - The page's slug.
     * @param oldSlugs - The page's redirect history.
     * @param self - The page's own `_id` when updating, so it does not conflict
     *   with itself; null when creating.
     * @param checkBlacklist - Whether to test the slug against the route
     *   blacklist (skipped when an update keeps its slug).
     * @throws Error describing the first conflict.
     */
    private async assertSlugsAvailable(
        slug: string,
        oldSlugs: string[],
        self: ObjectId | null,
        checkBlacklist: boolean
    ): Promise<void> {
        if (oldSlugs.includes(slug)) {
            throw new Error(`Cannot set slug to "${slug}" - this is already in the page's redirect history`);
        }
        if (checkBlacklist && await this.slugPolicy.isSlugBlacklisted(slug)) {
            throw new Error(`Slug "${slug}" conflicts with a blacklisted route pattern`);
        }
        const others = self ? { _id: { $ne: self } } : {};

        const holder = await this.pages.findOne({ ...others, $or: [{ slug }, { 'approved.slug': slug }] });
        if (holder) {
            throw new Error(`A page with slug "${slug}" already exists`);
        }
        const redirect = await this.pages.findOne({ ...others, $or: [{ oldSlugs: slug }, { 'approved.oldSlugs': slug }] });
        if (redirect) {
            throw new Error(`Slug "${slug}" conflicts with redirect from page "${redirect.title}"`);
        }

        if (oldSlugs.length > 0) {
            const [slugHolders, redirectHolders] = await Promise.all([
                this.pages.find({
                    ...others,
                    $or: [{ slug: { $in: oldSlugs } }, { 'approved.slug': { $in: oldSlugs } }]
                }).toArray(),
                this.pages.find({
                    ...others,
                    $or: [{ oldSlugs: { $in: oldSlugs } }, { 'approved.oldSlugs': { $in: oldSlugs } }]
                }).toArray()
            ]);
            for (const oldSlug of oldSlugs) {
                const page = slugHolders.find(
                    (candidate) => candidate.slug === oldSlug || candidate.approved?.slug === oldSlug
                );
                if (page) {
                    throw new Error(`Old slug "${oldSlug}" conflicts with existing page "${page.title}"`);
                }
                const redirecting = redirectHolders.find(
                    (candidate) => candidate.oldSlugs.includes(oldSlug)
                        || Boolean(candidate.approved?.oldSlugs?.includes(oldSlug))
                );
                if (redirecting) {
                    throw new Error(`Old slug "${oldSlug}" conflicts with redirect from page "${redirecting.title}"`);
                }
            }
        }

        return;
    }

    /**
     * Project one version of a page into the payload core merges onto its row.
     *
     * @param version - The working fields (the document) or the approved snapshot.
     * @param doc - The document, supplying fields a snapshot does not carry.
     * @returns The page fields for that version.
     */
    private toPayload(version: IPageVersionDocument | IPageDocument, doc: IPageDocument): ContentPayload<IPageContent> {
        return {
            title: version.title,
            slug: version.slug,
            oldSlugs: version.oldSlugs ?? [],
            content: version.content,
            description: version.description,
            keywords: version.keywords,
            published: version.published,
            ogImage: version.ogImage || undefined,
            authorId: doc.authorId
        };
    }

    /**
     * Drop the render caches for every slug a change may have affected, so the
     * next visitor is served whatever version core now resolves.
     *
     * Invalidation is best-effort and never throws. Every caller runs it after
     * the page document has already been written, and core treats a thrown
     * error as a failed author write and rolls back only its own row. A Redis
     * failure here would therefore split the page from core's record (for
     * example a soft-deleted page that core still lists as live). A failed
     * slug is logged as a warning instead, and its stale entry expires with
     * the cache TTL.
     *
     * @param slugs - The slugs to invalidate; duplicates and blanks are skipped.
     */
    private async invalidate(...slugs: Array<string | undefined>): Promise<void> {
        const unique = Array.from(new Set(slugs.filter((slug): slug is string => Boolean(slug))));
        const results = await Promise.allSettled(unique.map((slug) => this.markdown.invalidateAllCaches(slug)));
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                this.logger.warn(
                    { slug: unique[index], error: result.reason },
                    'Page render cache invalidation failed; stale render will expire with the cache TTL'
                );
            }
        });

        return;
    }
}
