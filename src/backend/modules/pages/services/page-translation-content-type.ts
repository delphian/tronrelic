/**
 * @fileoverview The `core:page-translation` managed content type — the storage
 * side of CMS page translations under the core content service.
 *
 * A translation is visitor-facing text, so it gets the same review, audit, and
 * soft deletion a page does. The core content service calls these methods after
 * it has run the veto hooks, recorded the actor, and decided the review state.
 * This type owns only what is specific to translations: parsing the translated
 * frontmatter, keeping one translation per page and language, and keeping two
 * versions of each in `module_pages_translations` — the latest edit in the
 * top-level fields and the approved version in the `approved` snapshot.
 *
 * Nothing outside the core content service calls these methods. The
 * translation service reaches them only through `IContentService`.
 *
 * @module backend/modules/pages/services/page-translation-content-type
 */

import { ObjectId } from 'mongodb';
import type { Collection } from 'mongodb';
import type {
    ContentPayload,
    IContentDescriptor,
    IContentDescriptorField,
    IContentReadRequest,
    IManagedContentType,
    IPageTranslationContent,
    ISystemLogService
} from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODE_PATTERN } from '@/types';
import type { IPageTranslationDocument, IPageTranslationVersionDocument } from '../database/index.js';
import type { MarkdownService } from './markdown.service.js';

/** Namespaced id of the page translation content type. */
export const PAGE_TRANSLATION_CONTENT_TYPE_ID = 'core:page-translation';

/** What a caller supplies to create a translation. */
export interface IPageTranslationCreateInput {
    /** Core content id of the page being translated. */
    pageId: string;
    /** Language code of the translation. */
    language: string;
    /** Translated markdown including the frontmatter block. */
    content: string;
    /** Fingerprint of the English text the translation was written against. */
    sourceHash: string;
}

/** What a caller supplies to change a translation. */
export interface IPageTranslationUpdateInput {
    /** Translated markdown including the frontmatter block. */
    content: string;
    /** Fingerprint of the English text the translation now matches. */
    sourceHash: string;
}

/**
 * Looks up the slugs a page is served at, its latest edit's and its approved
 * version's, so a translation change can drop the render caches of the
 * address it is served at.
 */
export type PageSlugLookup = (pageId: string) => Promise<string[]>;

/** The fields parsed out of a translation's markdown on every write. */
interface IParsedTranslationFields {
    title: string;
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
}

/**
 * Storage for the `core:page-translation` managed content type.
 */
export class PageTranslationContentType implements IManagedContentType<
    IPageTranslationContent,
    IPageTranslationCreateInput,
    IPageTranslationUpdateInput
> {
    readonly typeId = PAGE_TRANSLATION_CONTENT_TYPE_ID;
    readonly label = 'Page translation';

    /**
     * A translation is as public as the page it translates, and like a page
     * it is never offered to an external publish sink.
     */
    readonly classification = { egress: 'user', audience: 'public' } as const;

    /**
     * Everything a visitor or a search engine sees in the translated page.
     * `sourceHash` is left out: refreshing it only records which English text
     * the translation matches, and changes nothing a visitor sees.
     */
    readonly reviewedFields = ['content', 'title', 'description', 'keywords', 'ogImage', 'published'] as const;

    /**
     * @param translations - The `module_pages_translations` collection.
     * @param markdown - Parses frontmatter and owns the render caches.
     * @param slugsForPage - Finds the slugs whose caches a change must drop.
     * @param onApproved - Called after a version is approved, because that is
     *   the step that can change which pages are served in which language,
     *   including approvals made from the curation queue.
     * @param logger - Scoped logger for storage diagnostics.
     */
    constructor(
        private readonly translations: Collection<IPageTranslationDocument>,
        private readonly markdown: MarkdownService,
        private readonly slugsForPage: PageSlugLookup,
        private readonly onApproved: () => void,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Render a translation's latest edit for the curation queue.
     *
     * @param ref - `{ id }`, the core content id.
     * @returns The descriptor the queue renders.
     */
    async describe(ref: Record<string, unknown>): Promise<IContentDescriptor> {
        const doc = await this.findByContentId(String(ref.id ?? ''));
        let descriptor: IContentDescriptor = {
            title: 'Page translation (unavailable)',
            body: '',
            details: [{ label: 'Status', value: 'The underlying translation no longer exists.' }]
        };
        if (doc) {
            const { body } = this.markdown.parseMarkdown(doc.content);
            const [slug] = await this.slugsForPage(doc.pageId);
            const details: IContentDescriptorField[] = [
                { label: 'Language', value: doc.language },
                ...(slug ? [{ label: 'Translates page', value: slug }] : []),
                { label: 'Published', value: doc.published ? 'Yes' : 'No' },
                ...(doc.description ? [{ label: 'Description', value: doc.description }] : []),
                ...(doc.keywords.length > 0 ? [{ label: 'Keywords', value: doc.keywords.join(', ') }] : []),
                ...(doc.ogImage ? [{ label: 'Social image', value: doc.ogImage }] : [])
            ];
            descriptor = {
                title: `${doc.title} (${doc.language})`,
                body,
                ...(doc.ogImage ? { media: [{ url: doc.ogImage, kind: 'image' as const, alt: doc.title }] } : {}),
                details,
                editable: false
            };
        }

        return descriptor;
    }

    /**
     * Store a new translation under the core-issued id. Nothing is approved
     * here; the content service calls `approve` when the creator is a curator.
     *
     * @param id - The core content id.
     * @param input - The page, language, markdown, and source fingerprint.
     * @throws Error when the language or frontmatter is invalid, or the page
     *   already has a translation into that language.
     */
    async create(id: string, input: IPageTranslationCreateInput): Promise<void> {
        const pageId = this.requireText(input?.pageId, 'Page id');
        const language = this.requireLanguage(input?.language);
        const content = this.requireText(input?.content, 'Content');
        const sourceHash = this.requireText(input?.sourceHash, 'Source fingerprint');
        const fields = this.parseFields(content);

        const existing = await this.translations.findOne({ pageId, language });
        if (existing) {
            throw new Error(existing.deletedAt
                ? `A deleted translation into "${language}" exists for this page; restore it instead`
                : `This page already has a translation into "${language}"`);
        }

        const now = new Date();
        const doc: IPageTranslationDocument = {
            _id: new ObjectId(),
            contentId: id,
            deletedAt: null,
            approved: null,
            pageId,
            language,
            ...fields,
            content,
            sourceHash,
            createdAt: now,
            updatedAt: now
        };
        try {
            await this.translations.insertOne(doc);
        } catch (error) {
            throw this.toDuplicateError(error, language);
        }
        this.logger.info({ contentId: id, pageId, language }, `Created page translation: ${doc.title}`);

        return;
    }

    /**
     * Remove a translation whose create core could not finish, which frees
     * its page and language for a retry.
     *
     * @param id - The core content id issued for the abandoned create.
     */
    async discardCreate(id: string): Promise<void> {
        const doc = await this.findByContentId(id);
        if (doc) {
            await this.translations.deleteOne({ _id: doc._id });
            await this.invalidate(doc.pageId);
            this.logger.info({ contentId: id, language: doc.language }, 'Discarded unfinished page translation create');
        }

        return;
    }

    /**
     * Load translations at the versions core asks for. A request for the
     * approved version of a translation that has none is omitted.
     *
     * @param requests - The ids and versions to load.
     * @returns Each found translation's fields, keyed by content id.
     */
    async read(
        requests: ReadonlyArray<IContentReadRequest>
    ): Promise<Record<string, ContentPayload<IPageTranslationContent>>> {
        const ids = requests.map((request) => request.id);
        const docs = ids.length > 0 ? await this.translations.find({ contentId: { $in: ids } }).toArray() : [];
        const byId = new Map(docs.map((doc) => [doc.contentId, doc]));
        const result: Record<string, ContentPayload<IPageTranslationContent>> = {};
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
     * Replace a translation's latest edit. The approved snapshot is never
     * touched here.
     *
     * @param id - The core content id.
     * @param patch - The new markdown and source fingerprint.
     * @throws Error when the translation is missing or the frontmatter is invalid.
     */
    async update(id: string, patch: IPageTranslationUpdateInput): Promise<void> {
        const doc = await this.requireByContentId(id);
        const content = this.requireText(patch?.content, 'Content');
        const sourceHash = this.requireText(patch?.sourceHash, 'Source fingerprint');
        const fields = this.parseFields(content);

        await this.translations.updateOne(
            { _id: doc._id },
            { $set: { ...fields, content, sourceHash, updatedAt: new Date() } }
        );
        await this.invalidate(doc.pageId);
        this.logger.info({ contentId: id, language: doc.language }, `Updated page translation: ${fields.title}`);

        return;
    }

    /**
     * Soft-delete a translation. The document stays, and its page and
     * language stay reserved for a restore.
     *
     * @param id - The core content id.
     */
    async delete(id: string): Promise<void> {
        const doc = await this.requireByContentId(id);
        await this.translations.updateOne({ _id: doc._id }, { $set: { deletedAt: new Date() } });
        await this.invalidate(doc.pageId);
        this.logger.info({ contentId: id, language: doc.language }, `Soft-deleted page translation: ${doc.title}`);

        return;
    }

    /**
     * Bring a soft-deleted translation back.
     *
     * @param id - The core content id.
     */
    async restore(id: string): Promise<void> {
        const doc = await this.requireByContentId(id);
        await this.translations.updateOne({ _id: doc._id }, { $set: { deletedAt: null } });
        await this.invalidate(doc.pageId);
        this.logger.info({ contentId: id, language: doc.language }, `Restored page translation: ${doc.title}`);

        return;
    }

    /**
     * Copy the latest edit into the approved snapshot, so visitors start
     * seeing it. Safe to repeat.
     *
     * @param id - The core content id.
     */
    async approve(id: string): Promise<void> {
        const doc = await this.requireByContentId(id);
        const approved: IPageTranslationVersionDocument = {
            title: doc.title,
            content: doc.content,
            description: doc.description,
            keywords: doc.keywords,
            published: doc.published,
            ogImage: doc.ogImage,
            sourceHash: doc.sourceHash,
            approvedAt: new Date()
        };
        await this.translations.updateOne({ _id: doc._id }, { $set: { approved } });
        await this.invalidate(doc.pageId);
        this.onApproved();

        return;
    }

    // ---------------------------------------------------------------- internals

    /**
     * Find a translation document by its core content id.
     *
     * @param id - The core content id.
     * @returns The document, or null.
     */
    private async findByContentId(id: string): Promise<IPageTranslationDocument | null> {
        return this.translations.findOne({ contentId: String(id) });
    }

    /**
     * Find a translation document the content service expects to exist.
     *
     * @param id - The core content id.
     * @returns The document.
     * @throws Error when no translation carries that content id.
     */
    private async requireByContentId(id: string): Promise<IPageTranslationDocument> {
        const doc = await this.findByContentId(id);
        if (!doc) {
            throw new Error(`Page translation with content id ${id} not found`);
        }

        return doc;
    }

    /**
     * Read a required text value out of a write input.
     *
     * @param value - The caller's value.
     * @param label - What the value is, named in the refusal.
     * @returns The value.
     * @throws Error when it is missing or blank.
     */
    private requireText(value: unknown, label: string): string {
        const text = typeof value === 'string' ? value : '';
        if (!text.trim()) {
            throw new Error(`${label} is required`);
        }

        return text;
    }

    /**
     * Check a translation's language code. English is the page itself, so a
     * translation into it would compete with the page for the same address.
     *
     * @param value - The caller's language code.
     * @returns The code.
     * @throws Error when it is missing, malformed, or the default language.
     */
    private requireLanguage(value: unknown): string {
        const language = typeof value === 'string' ? value : '';
        if (!LANGUAGE_CODE_PATTERN.test(language)) {
            throw new Error(`"${language}" is not a valid language code`);
        }
        if (language === DEFAULT_LANGUAGE) {
            throw new Error(`The page itself is the "${DEFAULT_LANGUAGE}" version; a translation needs another language`);
        }

        return language;
    }

    /**
     * Parse the translated frontmatter into the stored fields. `slug` and
     * `oldSlugs` are ignored because a translation is always served at its
     * page's slug.
     *
     * @param content - Markdown including frontmatter.
     * @returns The parsed fields.
     * @throws Error when the frontmatter has no title.
     */
    private parseFields(content: string): IParsedTranslationFields {
        const { frontmatter } = this.markdown.parseMarkdown(content);
        if (!frontmatter.title) {
            throw new Error('Frontmatter must include a title field');
        }

        return {
            title: frontmatter.title,
            description: frontmatter.description || '',
            keywords: frontmatter.keywords || [],
            published: frontmatter.published || false,
            ogImage: frontmatter.ogImage || null
        };
    }

    /**
     * Give a duplicate refusal from the unique `(pageId, language)` index the
     * same message the check before the write gives. Two creates of the same
     * translation arriving together can both pass that check.
     *
     * @param error - What the write threw.
     * @param language - The language the write tried to store.
     * @returns The error to throw.
     */
    private toDuplicateError(error: unknown, language: string): unknown {
        const duplicate = error as { code?: number; keyPattern?: Record<string, unknown> } | null;
        const languageConflict = duplicate?.code === 11000 && duplicate.keyPattern?.language !== undefined;

        return languageConflict ? new Error(`This page already has a translation into "${language}"`) : error;
    }

    /**
     * Project one version of a translation into the payload core merges onto
     * its row.
     *
     * @param version - The working fields (the document) or the approved snapshot.
     * @param doc - The document, supplying the page and language a snapshot does not carry.
     * @returns The translation fields for that version.
     */
    private toPayload(
        version: IPageTranslationVersionDocument | IPageTranslationDocument,
        doc: IPageTranslationDocument
    ): ContentPayload<IPageTranslationContent> {
        return {
            pageId: doc.pageId,
            language: doc.language,
            title: version.title,
            content: version.content,
            description: version.description,
            keywords: version.keywords,
            published: version.published,
            ogImage: version.ogImage || undefined,
            sourceHash: version.sourceHash
        };
    }

    /**
     * Drop the render caches of the page a translation belongs to, so the
     * next visitor is served whatever version core now resolves. Dropping a
     * slug's caches drops every language's render at that slug.
     *
     * Best-effort and never throws, for the same reason the page type's
     * invalidation does not: the document is already written, and a thrown
     * error here would make core roll back only its own row.
     *
     * @param pageId - The page whose caches to drop.
     */
    private async invalidate(pageId: string): Promise<void> {
        try {
            const slugs = await this.slugsForPage(pageId);
            await Promise.all(slugs.map((slug) => this.markdown.invalidateAllCaches(slug)));
        } catch (error) {
            this.logger.warn(
                { pageId, error },
                'Page translation render cache invalidation failed; stale render will expire with the cache TTL'
            );
        }

        return;
    }
}
