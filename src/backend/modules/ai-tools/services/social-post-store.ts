/**
 * @file social-post-store.ts
 *
 * Owns the drafts behind the provider-neutral `core:social-post` content type:
 * destination-agnostic social posts an AI tool proposes and a curator reviews
 * before they fan out to whichever publish sinks (X, Telegram, …) the operator
 * selects. The store exists because the generic flow needs a record the
 * `core:social-post` curation type can resolve through its opaque `ref` — core
 * holds only `{ postId }` and reaches the text on demand, never the payload —
 * the same originator-owns-the-content contract the X and Telegram publishers
 * follow against their own collections.
 *
 * Each draft is one document in `module_ai-tools_social_posts` keyed by `id`, so
 * an inline curator edit and the approve/reject bookkeeping write never clobber
 * each other — every mutation is a field-level atomic Mongo operation. The store
 * deliberately knows nothing about destinations: routed delivery is the content
 * router's job, and `status` here tracks only the draft's own review lifecycle.
 */

import { randomUUID } from 'node:crypto';
import type { IDatabaseService, ISystemLogService } from '@/types';

/** Collection name owned by this module (manual `module_<id>_` prefix). */
const COLLECTION = 'module_ai-tools_social_posts';

/** Largest body a draft may carry, a coarse upper bound above any single destination's own limit. */
const MAX_BODY_LENGTH = 4000;

/**
 * The review lifecycle of one draft. `pending` until a curator decides; routed
 * delivery on approval is the router's concern, so `published` here means only
 * "the curator approved this draft", not "every destination accepted it" — the
 * per-destination outcomes live on the curation envelope, not the draft.
 */
export type SocialPostStatus = 'pending' | 'published' | 'rejected';

/**
 * A proposed social post awaiting (or past) curator review. The renderable
 * fields map straight onto an {@link IContentDescriptor} in the curation type's
 * `describe()`; `mediaUrl` is an already-public URL a publish sink that renders
 * media (X) downloads at delivery, while text-only sinks (Telegram) ignore it.
 */
export interface ISocialPostDraft {
    /** Stable opaque id; the curation envelope's `ref` is `{ postId: id }`. */
    id: string;
    /** Optional one-line heading a sink may render above the body. */
    title?: string;
    /** Primary post text every sink renders. */
    body: string;
    /** Optional public image URL a media-capable sink fetches at delivery. */
    mediaUrl?: string;
    /** Review lifecycle state. */
    status: SocialPostStatus;
    /** Attribution of what produced the draft (the proposing tool name). */
    source?: string;
    /** ISO 8601 creation timestamp. */
    createdAt: string;
    /** ISO 8601 last-mutation timestamp. */
    updatedAt: string;
}

/** What the proposing tool passes to create a draft. */
export interface ISocialPostCreate {
    /** Primary post text; required and non-empty. */
    body: string;
    /** Optional heading. */
    title?: string;
    /** Optional public image URL. */
    mediaUrl?: string;
    /** Attribution string recorded for audit. */
    source?: string;
}

/**
 * Store for `core:social-post` drafts. One instance per process, constructed in
 * the AI Tools module `init()`; every write is an atomic single-document Mongo
 * operation so a curator edit can never silently lose to an approve/reject.
 */
export class SocialPostStore {
    /**
     * @param database - Core database for the drafts collection.
     * @param logger - Scoped logger for diagnostics.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Ensure the unique `id` index and the `createdAt` sort index exist.
     * Idempotent; called during module `init()` so a fresh draft is always
     * addressable by its opaque ref.
     *
     * @returns Resolves once the indexes are present.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { createdAt: -1 });
    }

    /**
     * Persist a new pending draft and return it. The caller (the proposing tool)
     * has already validated the body; this re-asserts the invariants the store
     * owns so a bad write never reaches the collection regardless of caller.
     *
     * @param input - The draft fields the proposing tool supplies.
     * @returns The stored pending draft, including its generated id.
     * @throws If the body is empty or exceeds {@link MAX_BODY_LENGTH}.
     */
    async create(input: ISocialPostCreate): Promise<ISocialPostDraft> {
        const body = typeof input.body === 'string' ? input.body.trim() : '';
        if (!body) {
            throw new Error('Social post body is required');
        }
        if (body.length > MAX_BODY_LENGTH) {
            throw new Error(`Social post body exceeds ${MAX_BODY_LENGTH} characters`);
        }

        const now = new Date().toISOString();
        const draft: ISocialPostDraft = {
            id: randomUUID(),
            body,
            status: 'pending',
            createdAt: now,
            updatedAt: now
        };
        const title = typeof input.title === 'string' ? input.title.trim() : '';
        if (title) {
            draft.title = title;
        }
        const mediaUrl = typeof input.mediaUrl === 'string' ? input.mediaUrl.trim() : '';
        if (mediaUrl) {
            draft.mediaUrl = mediaUrl;
        }
        const source = typeof input.source === 'string' ? input.source.trim() : '';
        if (source) {
            draft.source = source;
        }

        await this.database.getCollection<ISocialPostDraft>(COLLECTION).insertOne(draft as ISocialPostDraft);
        this.logger.info({ postId: draft.id, source: draft.source }, 'Social post draft created for curation');
        return draft;
    }

    /**
     * Resolve a draft by id. The curation type calls this from `describe()` to
     * render the held post; a missing record is a normal outcome (the draft was
     * pruned or never existed), so this returns null rather than throwing.
     *
     * @param postId - The draft id from the curation envelope's `ref`.
     * @returns The draft, or null when absent.
     */
    async getById(postId: string): Promise<ISocialPostDraft | null> {
        const doc = await this.database
            .getCollection<ISocialPostDraft>(COLLECTION)
            // Coerce to a primitive string so the query can never carry a Mongo
            // operator object — equality-by-id on an admin-curated record.
            .findOne({ id: String(postId) });
        return doc ? stripMongoId(doc) : null;
    }

    /**
     * Mark a draft published as approve-time bookkeeping. Routed delivery to the
     * selected sinks has already run by the time the curation type's `onApprove`
     * calls this, so a draft that is missing or already decided is a benign
     * no-op, not a delivery failure — hence a boolean rather than a throw.
     *
     * @param postId - The draft id.
     * @returns True when a pending draft was transitioned.
     */
    async markPublished(postId: string): Promise<boolean> {
        return this.transition(postId, 'published');
    }

    /**
     * Mark a draft rejected as reject-time bookkeeping.
     *
     * @param postId - The draft id.
     * @returns True when a pending draft was transitioned.
     */
    async markRejected(postId: string): Promise<boolean> {
        return this.transition(postId, 'rejected');
    }

    /**
     * Apply a curator's inline body edit to a pending draft. Re-validates the
     * body so an edit can never persist an empty or oversized post; returns false
     * when the draft is gone or no longer pending so the queue can surface that
     * the edit did not apply.
     *
     * @param postId - The draft id.
     * @param body - The replacement body text.
     * @returns True when the edit was applied.
     * @throws If the new body is empty or exceeds {@link MAX_BODY_LENGTH}.
     */
    async editBody(postId: string, body: string): Promise<boolean> {
        const trimmed = typeof body === 'string' ? body.trim() : '';
        if (!trimmed) {
            throw new Error('Social post body is required');
        }
        if (trimmed.length > MAX_BODY_LENGTH) {
            throw new Error(`Social post body exceeds ${MAX_BODY_LENGTH} characters`);
        }
        const result = await this.database.getCollection<ISocialPostDraft>(COLLECTION).updateOne(
            { id: String(postId), status: 'pending' },
            { $set: { body: trimmed, updatedAt: new Date().toISOString() } }
        );
        return (result?.modifiedCount ?? 0) > 0;
    }

    /**
     * Atomically transition a pending draft to a terminal status. The
     * `status: 'pending'` filter makes the transition idempotent — a duplicate
     * call after the draft is already decided modifies nothing and returns false.
     *
     * @param postId - The draft id.
     * @param status - The terminal status to set.
     * @returns True when a pending draft was transitioned.
     */
    private async transition(postId: string, status: SocialPostStatus): Promise<boolean> {
        const result = await this.database.getCollection<ISocialPostDraft>(COLLECTION).updateOne(
            { id: String(postId), status: 'pending' },
            { $set: { status, updatedAt: new Date().toISOString() } }
        );
        return (result?.modifiedCount ?? 0) > 0;
    }
}

/**
 * Strip the driver-assigned `_id` Mongo returns on every read, since the public
 * {@link ISocialPostDraft} shape does not include it.
 *
 * @param doc - The raw Mongo document.
 * @returns The document without `_id`.
 */
function stripMongoId<T extends Record<string, unknown>>(doc: T): ISocialPostDraft {
    const cleaned = { ...doc };
    delete (cleaned as Record<string, unknown>)._id;
    return cleaned as unknown as ISocialPostDraft;
}
