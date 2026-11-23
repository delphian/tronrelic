/**
 * @file ProposalStore.ts
 *
 * Storage for proposed edits that wait in the central curation queue: saved
 * prompt bodies in `module_ai-tools_prompt_proposals` and static prompt
 * variable text in `module_ai-tools_variable_proposals`. Curation holds a
 * pointer, never the payload, so each proposal is written here first and the
 * curation item carries only its id.
 *
 * The two kinds share one store class because their records move through the
 * same states and are read the same way; only the collection and the field
 * naming what the proposal changes differ. Every state change is a
 * conditional write that only succeeds from the expected status, which is what
 * makes a repeated or late decision a harmless no-op.
 */

import type { IDatabaseService, SavedPromptProposalStatus } from '@/types';

/**
 * The fields every stored proposal carries, whatever it changes. The concrete
 * record types (`ISavedPromptProposal`, `IPromptVariableProposal`) add the
 * target and the proposed text.
 */
export interface IStoredProposal {
    /** Proposal id; the curation item's `ref` carries it as `proposalId`. */
    id: string;
    /** Where the proposal stands. Both kinds share this lifecycle. */
    status: SavedPromptProposalStatus;
    /** Id of the curation item holding the proposal, once it is held. */
    curationItemId?: string;
    /** ISO timestamp of when the proposal was made. */
    createdAt: string;
    /** ISO timestamp of when it left `pending`. */
    decidedAt?: string;
    /** Who moved it out of `pending`. */
    decidedBy?: string;
    /** Why an approved proposal could not be written. */
    failureReason?: string;
}

/** Fields a transition out of `pending` may record alongside the new status. */
export interface IProposalTransition {
    /** Who caused the transition: a curator's user id or a `system:` id. */
    decidedBy?: string;
    /** Why an approved proposal could not be applied. */
    failureReason?: string;
}

/**
 * Persistence for one kind of proposal. Holds no rules about when a proposal
 * may be made or decided; the edits service that owns the kind does.
 *
 * @typeParam TProposal - The stored record type.
 */
export class ProposalStore<TProposal extends IStoredProposal> {
    /**
     * @param database - Core database; the collection is named with the module prefix by hand.
     * @param collection - The collection this kind of proposal lives in.
     * @param targetField - The record field naming what the proposal changes,
     *        such as `promptId` or `variableName`. Pending proposals are looked
     *        up by it so a newer proposal or a direct edit can withdraw them.
     */
    constructor(
        private readonly database: IDatabaseService,
        private readonly collection: string,
        private readonly targetField: keyof TProposal & string
    ) {}

    /**
     * Ensure the indexes the reads below use. Idempotent; called from module `init()`.
     *
     * @returns Resolves once the indexes exist.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(this.collection, { id: 1 }, { unique: true });
        await this.database.createIndex(this.collection, { [this.targetField]: 1, status: 1 });
        await this.database.createIndex(this.collection, { status: 1, createdAt: -1 });
    }

    /**
     * Store a new proposal.
     *
     * @param proposal - The complete record, normally with status `pending`.
     * @returns Resolves once it is written.
     */
    async insert(proposal: TProposal): Promise<void> {
        await this.records().insertOne({ ...proposal } as never);
    }

    /**
     * Read one proposal.
     *
     * @param id - The proposal id.
     * @returns The proposal, or null when no such id exists.
     */
    async get(id: string): Promise<TProposal | null> {
        const doc = await this.records().findOne({ id: String(id) } as never);
        return doc ? stripMongoId<TProposal>(doc) : null;
    }

    /**
     * List every pending proposal, newest first, for the admin page's notice.
     *
     * @returns The pending proposals.
     */
    async listPending(): Promise<TProposal[]> {
        const docs = await this.records().find({ status: 'pending' } as never).sort({ createdAt: -1 }).toArray();
        return docs.map((doc) => stripMongoId<TProposal>(doc));
    }

    /**
     * List the pending proposals for one target, so a newer proposal or a
     * direct edit can withdraw them.
     *
     * @param target - The value of the target field, such as a prompt id or a variable name.
     * @returns The target's pending proposals.
     */
    async listPendingFor(target: string): Promise<TProposal[]> {
        const docs = await this.records().find({ [this.targetField]: String(target), status: 'pending' } as never).toArray();
        return docs.map((doc) => stripMongoId<TProposal>(doc));
    }

    /**
     * Count every pending proposal, for the cap on how many may wait at once.
     *
     * @returns The number of pending proposals.
     */
    async countPending(): Promise<number> {
        return this.records().countDocuments({ status: 'pending' } as never);
    }

    /**
     * Record which curation item holds a proposal.
     *
     * @param id - The proposal id.
     * @param curationItemId - The curation item id `hold()` returned.
     * @returns Resolves once it is written.
     */
    async setCurationItemId(id: string, curationItemId: string): Promise<void> {
        await this.records().updateOne({ id: String(id) } as never, { $set: { curationItemId: String(curationItemId) } } as never);
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
        fields: IProposalTransition = {}
    ): Promise<TProposal | null> {
        const set: Partial<IStoredProposal> = { status: to, decidedAt: new Date().toISOString() };
        if (fields.decidedBy) {
            set.decidedBy = fields.decidedBy;
        }
        if (fields.failureReason) {
            set.failureReason = fields.failureReason;
        }
        const updated = await this.records().findOneAndUpdate(
            { id: String(id), status: from } as never,
            { $set: set } as never,
            { returnDocument: 'after' }
        ) as unknown as Record<string, unknown> | null;
        return updated ? stripMongoId<TProposal>(updated) : null;
    }

    /** The raw collection handle for this kind of proposal. */
    private records() {
        return this.database.getCollection<Record<string, unknown>>(this.collection);
    }
}

/** Shape a raw Mongo document into the published record by dropping the driver-assigned `_id`. */
function stripMongoId<T>(doc: object): T {
    const cleaned = { ...doc } as Record<string, unknown>;
    delete cleaned._id;
    return cleaned as unknown as T;
}
