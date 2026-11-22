/**
 * @file saved-prompt-proposal-store.ts
 *
 * Storage for proposed saved-prompt edits, in `module_ai-tools_prompt_proposals`.
 * Curation holds a pointer, never the payload, so each proposal is written
 * here first and the curation item carries only its id. Every state change is
 * a conditional write that only succeeds from `pending`, which is what makes a
 * repeated or late decision a harmless no-op.
 */

import type { IDatabaseService, ISavedPromptProposal, SavedPromptProposalStatus } from '@/types';

/** Collection name owned by this module (manual `module_<id>_` prefix). */
const COLLECTION = 'module_ai-tools_prompt_proposals';

/** Fields a transition out of `pending` may record alongside the new status. */
export interface ISavedPromptProposalTransition {
    /** Who caused the transition: a curator's user id or a `system:` id. */
    decidedBy?: string;
    /** Why an approved proposal could not be applied. */
    failureReason?: string;
}

/**
 * Persistence for {@link ISavedPromptProposal} records. Holds no rules about
 * when a proposal may be made or decided; `SavedPromptEditsService` owns those.
 */
export class SavedPromptProposalStore {
    /**
     * @param database - Core database; the collection is named with the module prefix by hand.
     */
    constructor(private readonly database: IDatabaseService) {}

    /**
     * Ensure the indexes the reads below use. Idempotent; called from module `init()`.
     *
     * @returns Resolves once the indexes exist.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(COLLECTION, { id: 1 }, { unique: true });
        await this.database.createIndex(COLLECTION, { promptId: 1, status: 1 });
        await this.database.createIndex(COLLECTION, { status: 1, createdAt: -1 });
    }

    /**
     * Store a new proposal.
     *
     * @param proposal - The complete record, normally with status `pending`.
     * @returns Resolves once it is written.
     */
    async insert(proposal: ISavedPromptProposal): Promise<void> {
        const collection = this.database.getCollection<ISavedPromptProposal>(COLLECTION);
        await collection.insertOne({ ...proposal });
    }

    /**
     * Read one proposal.
     *
     * @param id - The proposal id.
     * @returns The proposal, or null when no such id exists.
     */
    async get(id: string): Promise<ISavedPromptProposal | null> {
        const collection = this.database.getCollection<ISavedPromptProposal>(COLLECTION);
        const doc = await collection.findOne({ id: String(id) });
        return doc ? stripMongoId(doc) : null;
    }

    /**
     * List every pending proposal, newest first, for the saved-prompt editor.
     *
     * @returns The pending proposals.
     */
    async listPending(): Promise<ISavedPromptProposal[]> {
        const collection = this.database.getCollection<ISavedPromptProposal>(COLLECTION);
        const docs = await collection.find({ status: 'pending' }).sort({ createdAt: -1 }).toArray();
        return docs.map(stripMongoId);
    }

    /**
     * List the pending proposals for one prompt, so a newer proposal or a
     * direct save can withdraw them.
     *
     * @param promptId - The saved prompt id.
     * @returns The prompt's pending proposals.
     */
    async listPendingForPrompt(promptId: string): Promise<ISavedPromptProposal[]> {
        const collection = this.database.getCollection<ISavedPromptProposal>(COLLECTION);
        const docs = await collection.find({ promptId: String(promptId), status: 'pending' }).toArray();
        return docs.map(stripMongoId);
    }

    /**
     * Count every pending proposal, for the cap on how many may wait at once.
     *
     * @returns The number of pending proposals.
     */
    async countPending(): Promise<number> {
        const collection = this.database.getCollection<ISavedPromptProposal>(COLLECTION);
        return collection.countDocuments({ status: 'pending' });
    }

    /**
     * Record which curation item holds a proposal.
     *
     * @param id - The proposal id.
     * @param curationItemId - The curation item id `hold()` returned.
     * @returns Resolves once it is written.
     */
    async setCurationItemId(id: string, curationItemId: string): Promise<void> {
        const collection = this.database.getCollection<ISavedPromptProposal>(COLLECTION);
        await collection.updateOne({ id: String(id) }, { $set: { curationItemId: String(curationItemId) } });
    }

    /**
     * Move a proposal out of one status into another, only if it is still in
     * the expected status. Two decisions racing on one proposal therefore
     * cannot both succeed.
     *
     * @param id - The proposal id.
     * @param from - The status the proposal must currently have.
     * @param to - The status to move it to.
     * @param fields - Who caused the move, and why when it failed.
     * @returns The updated proposal, or null when it was missing or not in `from`.
     */
    async transition(
        id: string,
        from: SavedPromptProposalStatus,
        to: SavedPromptProposalStatus,
        fields: ISavedPromptProposalTransition = {}
    ): Promise<ISavedPromptProposal | null> {
        const set: Partial<ISavedPromptProposal> = { status: to, decidedAt: new Date().toISOString() };
        if (fields.decidedBy) {
            set.decidedBy = fields.decidedBy;
        }
        if (fields.failureReason) {
            set.failureReason = fields.failureReason;
        }
        const collection = this.database.getCollection<ISavedPromptProposal>(COLLECTION);
        const updated = await collection.findOneAndUpdate(
            { id: String(id), status: from },
            { $set: set },
            { returnDocument: 'after' }
        ) as ISavedPromptProposal | null;
        return updated ? stripMongoId(updated as unknown as Record<string, unknown>) : null;
    }
}

/** Shape a raw Mongo document into the published record by dropping the driver-assigned `_id`. */
function stripMongoId<T extends object>(doc: T): ISavedPromptProposal {
    const cleaned = { ...doc } as Record<string, unknown>;
    delete cleaned._id;
    return cleaned as unknown as ISavedPromptProposal;
}
