/**
 * @file social-post.test.ts
 *
 * Contract tests for the provider-neutral social-posting primitive: the
 * SocialPostStore draft lifecycle, the `core:social-post` curation type's
 * delegations (describe / approve / reject / edit), and the `propose-social-post`
 * tool handler's validation and curation-hold path.
 *
 * The mock IDatabaseService backs `getCollection` with an in-memory Map keyed by
 * draft id and honours the `{ id, status: 'pending' }` filter the store's atomic
 * transitions depend on, so the idempotency-of-decision behaviour is exercised
 * without a live mongod. This is a contract test, not a race test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDatabaseService, ICurationService, ISystemLogService } from '@/types';
import { SocialPostStore, type ISocialPostDraft } from '../services/social-post-store.js';
import {
    SOCIAL_POST_CURATION_TYPE_ID,
    createSocialPostCurationType,
    createSocialPostTool
} from '../social-post.js';

/**
 * Build a minimal in-memory collection supporting exactly the driver methods
 * SocialPostStore calls: `insertOne`, `findOne` by id, and `updateOne` with the
 * compound `{ id, status }` filter the transitions rely on.
 *
 * @returns A mock collection plus the backing map for assertions.
 */
function createMockCollection() {
    const docs = new Map<string, ISocialPostDraft>();
    return {
        _docs: docs,
        findOne: vi.fn(async (filter: { id?: unknown; status?: unknown }) => {
            const doc = docs.get(String(filter.id));
            return doc ? { ...doc } : null;
        }),
        insertOne: vi.fn(async (doc: ISocialPostDraft) => {
            docs.set(doc.id, { ...doc });
            return { insertedId: doc.id };
        }),
        updateOne: vi.fn(async (filter: { id?: unknown; status?: unknown }, update: { $set: Partial<ISocialPostDraft> }) => {
            const doc = docs.get(String(filter.id));
            // Honour the status guard so a second decision on an already-decided
            // draft modifies nothing — the store's idempotency contract.
            if (!doc || (filter.status !== undefined && doc.status !== filter.status)) {
                return { matchedCount: 0, modifiedCount: 0 };
            }
            docs.set(doc.id, { ...doc, ...update.$set });
            return { matchedCount: 1, modifiedCount: 1 };
        })
    };
}

/**
 * Build a mock IDatabaseService whose `getCollection` always returns the one
 * shared collection (the store only ever touches a single collection).
 *
 * @param collection - The mock collection to hand back.
 * @returns A database service stub typed as the real interface.
 */
function createMockDatabase(collection: ReturnType<typeof createMockCollection>): IDatabaseService {
    return {
        getCollection: vi.fn(() => collection),
        createIndex: vi.fn(async () => undefined)
    } as unknown as IDatabaseService;
}

/** Silent logger stub satisfying the methods the code under test calls. */
const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(() => logger)
} as unknown as ISystemLogService;

describe('SocialPostStore', () => {
    let collection: ReturnType<typeof createMockCollection>;
    let store: SocialPostStore;

    beforeEach(() => {
        vi.clearAllMocks();
        collection = createMockCollection();
        store = new SocialPostStore(createMockDatabase(collection), logger);
    });

    it('creates a pending draft, trimming and persisting the optional fields', async () => {
        const draft = await store.create({ body: '  hello world  ', title: ' Heading ', mediaUrl: 'https://x/i.png', source: 'ai-tool:propose-social-post' });
        expect(draft.id).toBeTruthy();
        expect(draft.status).toBe('pending');
        expect(draft.body).toBe('hello world');
        expect(draft.title).toBe('Heading');
        expect(draft.mediaUrl).toBe('https://x/i.png');
        expect(collection._docs.get(draft.id)?.body).toBe('hello world');
    });

    it('rejects an empty body', async () => {
        await expect(store.create({ body: '   ' })).rejects.toThrow(/body is required/);
    });

    it('rejects an oversized body', async () => {
        await expect(store.create({ body: 'x'.repeat(4001) })).rejects.toThrow(/exceeds/);
    });

    it('marks a pending draft published exactly once (idempotent transition)', async () => {
        const draft = await store.create({ body: 'post' });
        expect(await store.markPublished(draft.id)).toBe(true);
        expect(collection._docs.get(draft.id)?.status).toBe('published');
        // A second decision on an already-published draft is a benign no-op.
        expect(await store.markPublished(draft.id)).toBe(false);
        expect(await store.markRejected(draft.id)).toBe(false);
    });

    it('returns null for a missing draft', async () => {
        expect(await store.getById('nope')).toBeNull();
    });

    it('edits the body only while pending, validating the new text', async () => {
        const draft = await store.create({ body: 'original' });
        expect(await store.editBody(draft.id, ' updated ')).toBe(true);
        expect(collection._docs.get(draft.id)?.body).toBe('updated');
        await expect(store.editBody(draft.id, '  ')).rejects.toThrow(/body is required/);
        // After a terminal decision the edit no longer applies.
        await store.markRejected(draft.id);
        expect(await store.editBody(draft.id, 'late')).toBe(false);
    });
});

describe('createSocialPostCurationType', () => {
    let collection: ReturnType<typeof createMockCollection>;
    let store: SocialPostStore;

    beforeEach(() => {
        vi.clearAllMocks();
        collection = createMockCollection();
        store = new SocialPostStore(createMockDatabase(collection), logger);
    });

    it('declares the destination-routing contract', () => {
        const type = createSocialPostCurationType(store, logger);
        expect(type.typeId).toBe(SOCIAL_POST_CURATION_TYPE_ID);
        expect(type.publishesToDestinations).toBe(true);
        expect(type.classification).toEqual({ egress: 'external', audience: 'public' });
    });

    it('describes a draft into a generic descriptor, with media when present', async () => {
        const type = createSocialPostCurationType(store, logger);
        const draft = await store.create({ body: 'body text', title: 'T', mediaUrl: 'https://x/i.png' });
        const desc = await type.describe({ postId: draft.id });
        expect(desc.title).toBe('T');
        expect(desc.body).toBe('body text');
        expect(desc.media?.[0]?.url).toBe('https://x/i.png');
        expect(desc.editable).toBe(true);
    });

    it('reports unavailable content when the draft is gone', async () => {
        const type = createSocialPostCurationType(store, logger);
        const desc = await type.describe({ postId: 'missing' });
        expect(desc.title).toMatch(/unavailable/i);
    });

    it('declares declarative decision bookkeeping', () => {
        const type = createSocialPostCurationType(store, logger);
        expect(type.decisionStatus).toEqual({ approved: 'published', rejected: 'rejected' });
    });

    it('applies the decision status through applyEdit — published on approve, rejected on reject', async () => {
        const type = createSocialPostCurationType(store, logger);
        const approved = await store.create({ body: 'a' });
        await type.applyEdit!({ postId: approved.id }, { status: 'published' });
        expect(collection._docs.get(approved.id)?.status).toBe('published');

        const rejected = await store.create({ body: 'b' });
        await type.applyEdit!({ postId: rejected.id }, { status: 'rejected' });
        expect(collection._docs.get(rejected.id)?.status).toBe('rejected');
    });

    it('treats a status transition on an already-decided draft as a benign no-op', async () => {
        const type = createSocialPostCurationType(store, logger);
        const draft = await store.create({ body: 'c' });
        await type.applyEdit!({ postId: draft.id }, { status: 'published' });
        // The second transition finds no pending draft; it must not throw.
        await expect(type.applyEdit!({ postId: draft.id }, { status: 'rejected' })).resolves.toBeUndefined();
        expect(collection._docs.get(draft.id)?.status).toBe('published');
    });

    it('rejects an unsupported status transition', async () => {
        const type = createSocialPostCurationType(store, logger);
        const draft = await store.create({ body: 'd' });
        await expect(type.applyEdit!({ postId: draft.id }, { status: 'archived' })).rejects.toThrow(/unsupported/i);
    });

    it('throws when an edit targets a missing draft', async () => {
        const type = createSocialPostCurationType(store, logger);
        await expect(type.applyEdit!({ postId: 'missing' }, { body: 'x' })).rejects.toThrow(/not found or no longer pending/);
    });
});

describe('createSocialPostTool', () => {
    let collection: ReturnType<typeof createMockCollection>;
    let store: SocialPostStore;
    let curation: { hold: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();
        collection = createMockCollection();
        store = new SocialPostStore(createMockDatabase(collection), logger);
        curation = { hold: vi.fn().mockResolvedValue({ id: 'curation-1' }) };
    });

    /**
     * Build the tool with the test's store and a curation stub.
     *
     * @param withCuration - Whether the curation service resolves (true) or is absent (false).
     * @returns The tool under test.
     */
    function buildTool(withCuration = true) {
        return createSocialPostTool({
            store,
            getCuration: () => (withCuration ? (curation as unknown as ICurationService) : undefined),
            logger
        });
    }

    it('classifies as external/irreversible/forces-curator-review bound to the social-post type', () => {
        const tool = buildTool();
        expect(tool.name).toBe('propose-social-post');
        expect(tool.capability).toMatchObject({
            sideEffect: 'external',
            reversible: false,
            forcesCuratorReview: true,
            curationTypeId: SOCIAL_POST_CURATION_TYPE_ID
        });
    });

    it('rejects an empty body without touching the store', async () => {
        const tool = buildTool();
        const result = await tool.handler({ body: '   ' }) as { success: boolean };
        expect(result.success).toBe(false);
        expect(collection._docs.size).toBe(0);
    });

    it('rejects a non-http(s) imageUrl scheme', async () => {
        const tool = buildTool();
        const result = await tool.handler({ body: 'ok', imageUrl: 'ftp://evil/x.png' }) as { success: boolean; error?: string };
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/http/i);
    });

    it('drafts and holds the post for curation on a valid call', async () => {
        const tool = buildTool();
        const result = await tool.handler({ body: 'gm tron', title: 'Daily', imageUrl: 'https://x/i.png' }) as { success: boolean; pendingReview?: boolean; postId?: string };
        expect(result.success).toBe(true);
        expect(result.pendingReview).toBe(true);
        expect(result.postId).toBeTruthy();
        expect(curation.hold).toHaveBeenCalledWith(expect.objectContaining({
            typeId: SOCIAL_POST_CURATION_TYPE_ID,
            ref: { postId: result.postId }
        }));
    });

    it('fails closed when curation is unavailable', async () => {
        const tool = buildTool(false);
        const result = await tool.handler({ body: 'gm' }) as { success: boolean; error?: string };
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/curation/i);
        // Nothing held, and no draft orphaned (curation checked before create).
        expect(collection._docs.size).toBe(0);
        expect(curation.hold).not.toHaveBeenCalled();
    });
});
