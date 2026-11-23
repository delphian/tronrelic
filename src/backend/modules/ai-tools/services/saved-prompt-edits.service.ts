/**
 * @file saved-prompt-edits.service.ts
 *
 * Proposed edits to saved prompts, reviewed in the central curation queue.
 * An AI tool may suggest a new body for a saved prompt, but saving a prompt is
 * restricted to a signed-in admin because a prompt body can reference secret
 * `{%name%}` variables that expand when it runs. So a proposal is stored, held
 * in `/system/curation` under `ai-tools:saved-prompt-edit`, and written to the
 * prompt only when a signed-in admin approves it.
 *
 * Rules this service owns:
 * - Only the body changes. Model, tool allowlist, and triggers are never part
 *   of a proposal, so a proposal cannot widen what a prompt may do.
 * - One pending proposal per prompt. A newer one, or a direct save or delete on
 *   `/system/ai-tools`, withdraws the older one as `superseded`. Two proposals
 *   made in the same instant can both be stored; the approval's `updatedAt`
 *   check then fails the second and tells the curator to propose it again.
 * - An approval writes only if the prompt still carries the `updatedAt` the
 *   proposal was based on; otherwise the proposal is marked `failed`.
 */

import { randomUUID } from 'node:crypto';
import type {
    IContentChangeSet,
    IContentDescriptor,
    ICurationService,
    ISavedPromptProposal,
    ISystemLogService
} from '@/types';
import { isSignedInCuratorId } from '@/types';
import { buildContentChangeSet } from '../../../services/buildContentChangeSet.js';
import type { ProposalStore } from './ProposalStore.js';
import { ProposalCurationQueue } from './ProposalCurationQueue.js';
import type { SavedPromptsService } from './saved-prompts.service.js';
import { listPromptVariableTokens } from './prompt-variable-registry.js';

/** Curation type id proposals are held under; the propose tool binds its `curationTypeId` to it. */
export const SAVED_PROMPT_EDIT_CURATION_TYPE_ID = 'ai-tools:saved-prompt-edit';

/** Collection saved-prompt edit proposals are stored in (manual `module_<id>_` prefix). */
export const SAVED_PROMPT_PROPOSALS_COLLECTION = 'module_ai-tools_prompt_proposals';

/** Most proposals allowed to wait for a curator at once, so a looping agent cannot flood the queue. */
export const MAX_PENDING_PROMPT_PROPOSALS = 20;

/** The fields a curator compares, in the order the review screen lists them. */
const CHANGE_FIELDS = [
    { name: 'prompt', label: 'Prompt body' },
    { name: 'variables', label: 'Prompt variables referenced' }
] as const;

/** What a caller supplies to propose an edit. */
export interface ISavedPromptEditProposalInput {
    /** Id of the saved prompt to change. */
    promptId: string;
    /** The full body the prompt should have after approval. */
    proposedPrompt: string;
    /** Why the change is wanted, shown to the curator. */
    reason: string;
    /** What produced the proposal, for the audit trail. */
    source: string;
    /** User id of the person whose session proposed it, when known. */
    proposedBy?: string;
}

/** What a successful proposal reports back to the tool. */
export interface ISavedPromptEditProposalResult {
    /** The stored proposal. */
    proposal: ISavedPromptProposal;
    /** How many older pending proposals for the same prompt were withdrawn. */
    supersededCount: number;
    /** Variable tokens the proposed body references that the current body does not. */
    variablesAdded: string[];
    /** Variable tokens the current body references that the proposed body does not. */
    variablesRemoved: string[];
}

/** Thrown for a proposal the caller can fix, such as an unknown prompt or an unchanged body. */
export class SavedPromptEditError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SavedPromptEditError';
    }
}

/**
 * Orchestrates proposing, deciding, and withdrawing saved-prompt edits.
 */
export class SavedPromptEditsService {
    /** Holds and withdraws proposals in the curation queue. */
    private readonly queue: ProposalCurationQueue<ISavedPromptProposal>;

    /**
     * @param store - Proposal records, in {@link SAVED_PROMPT_PROPOSALS_COLLECTION}.
     * @param savedPrompts - The prompt library an approval writes to.
     * @param getCuration - Resolves the central curation service at call time,
     *        because curation publishes itself after this module initialises.
     * @param logger - Module logger.
     */
    constructor(
        private readonly store: ProposalStore<ISavedPromptProposal>,
        private readonly savedPrompts: Pick<SavedPromptsService, 'get' | 'updatePromptIfUnchanged'>,
        getCuration: () => ICurationService | undefined,
        private readonly logger: ISystemLogService
    ) {
        this.queue = new ProposalCurationQueue(store, getCuration, SAVED_PROMPT_EDIT_CURATION_TYPE_ID, 'saved prompt edit', logger);
    }

    /**
     * Store a proposal, withdraw any older pending one for the same prompt,
     * and hold the new one for a curator.
     *
     * @param input - The prompt, the proposed body, and attribution.
     * @returns The proposal and what it changes about variable references.
     * @throws SavedPromptEditError when the prompt is unknown, the body is
     *         unchanged, too many proposals are waiting, or curation is unavailable.
     */
    async propose(input: ISavedPromptEditProposalInput): Promise<ISavedPromptEditProposalResult> {
        const curation = this.queue.curation();
        if (!curation) {
            throw new SavedPromptEditError('The curation service is unavailable, so the edit cannot be held for review.');
        }
        const prompt = await this.savedPrompts.get(input.promptId);
        if (!prompt) {
            throw new SavedPromptEditError('No saved prompt has that id.');
        }
        const proposedPrompt = input.proposedPrompt.trim();
        if (!proposedPrompt) {
            throw new SavedPromptEditError('The proposed prompt body is empty.');
        }
        // Both sides trimmed, because a save trims the stored body too, so a
        // proposal differing only in surrounding whitespace changes nothing.
        if (proposedPrompt === prompt.prompt.trim()) {
            throw new SavedPromptEditError('The proposed body is identical to the current body, so there is nothing to review.');
        }
        const olderPending = await this.store.listPendingFor(prompt.id);
        // Superseding frees a slot, so an agent revising its own proposal is
        // never blocked by the cap it is already counted against.
        if (await this.store.countPending() - olderPending.length >= MAX_PENDING_PROMPT_PROPOSALS) {
            throw new SavedPromptEditError(`${MAX_PENDING_PROMPT_PROPOSALS} prompt edits are already waiting for review. Ask an admin to decide them before proposing more.`);
        }

        const proposal: ISavedPromptProposal = {
            id: randomUUID(),
            promptId: prompt.id,
            promptName: prompt.name,
            baseUpdatedAt: prompt.updatedAt,
            proposedPrompt,
            reason: input.reason.trim(),
            source: input.source,
            ...(input.proposedBy ? { proposedBy: input.proposedBy } : {}),
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        const supersededCount = await this.queue.supersede(olderPending, 'A newer proposal for the same prompt replaced it.');
        await this.store.insert(proposal);
        const curationItemId = await this.queue.hold(curation, proposal.id, input.source);
        this.logger.info({ proposalId: proposal.id, promptId: prompt.id, curationId: curationItemId, supersededCount }, 'Saved prompt edit proposed and held for curation');

        const current = listPromptVariableTokens(prompt.prompt);
        const proposed = listPromptVariableTokens(proposedPrompt);
        return {
            proposal: { ...proposal, curationItemId },
            supersededCount,
            variablesAdded: proposed.filter((token) => !current.includes(token)),
            variablesRemoved: current.filter((token) => !proposed.includes(token))
        };
    }

    /**
     * Withdraw every pending proposal for a prompt. Called when an admin saves
     * or deletes the prompt directly, because the proposal was based on a
     * version that no longer exists and approving it would fail anyway.
     *
     * @param promptId - The prompt that changed.
     * @param reason - Logged with each withdrawal.
     * @returns How many proposals were withdrawn.
     */
    async supersedeForPrompt(promptId: string, reason: string): Promise<number> {
        const pending = await this.store.listPendingFor(promptId);
        return this.queue.supersede(pending, reason);
    }

    /**
     * List every pending proposal, for the saved-prompt editor's notice.
     *
     * @returns The pending proposals, newest first.
     */
    async listPending(): Promise<ISavedPromptProposal[]> {
        return this.store.listPending();
    }

    /**
     * Apply a curator's decision. Curation records the decision before it
     * calls this, so the method must be safe to repeat: a proposal no longer
     * pending is left alone.
     *
     * Approval first claims the proposal by moving it to `applied`, so two
     * approvals cannot both write. If the prompt changed or was deleted since
     * the proposal, the claim is turned into `failed` and an error is thrown so
     * the curator is told nothing was written.
     *
     * @param proposalId - The proposal the curation item points at.
     * @param decision - Which way the curator decided.
     * @param actorId - The curator's user id, from the curation commit context.
     * @returns Resolves once the decision is applied or found to be stale.
     * @throws When an approval has no signed-in curator, or the prompt changed since the proposal.
     */
    async applyDecision(proposalId: string, decision: 'applied' | 'rejected', actorId: string | undefined): Promise<void> {
        if (decision === 'rejected') {
            const rejected = await this.store.transition(proposalId, 'pending', 'rejected', { decidedBy: actorId });
            if (!rejected) {
                this.logger.info({ proposalId }, 'Saved prompt edit rejection no-op: proposal missing or no longer pending');
            }
        } else {
            await this.applyApproval(proposalId, actorId);
        }
    }

    /**
     * The approval half of {@link applyDecision}: claim, write if unchanged,
     * and mark the claim failed when the prompt moved on.
     *
     * @param proposalId - The proposal being approved.
     * @param actorId - The approving curator's user id.
     * @returns Resolves once the body is written or the approval is found to be a no-op.
     * @throws When there is no signed-in curator, or the prompt changed since the proposal.
     */
    private async applyApproval(proposalId: string, actorId: string | undefined): Promise<void> {
        // Curation refuses this already for a type that requires a signed-in
        // curator. Checking again here keeps the write safe if the type is
        // ever decided through another path.
        if (!actorId || !isSignedInCuratorId(actorId)) {
            throw new Error('Only a signed-in admin can approve a saved prompt edit.');
        }
        const claimed = await this.store.transition(proposalId, 'pending', 'applied', { decidedBy: actorId });
        if (!claimed) {
            this.logger.info({ proposalId }, 'Saved prompt edit approval no-op: proposal missing or no longer pending');
        } else {
            const written = await this.savedPrompts.updatePromptIfUnchanged(
                claimed.promptId,
                claimed.baseUpdatedAt,
                claimed.proposedPrompt,
                actorId
            );
            if (!written) {
                const failureReason = 'The prompt was changed or deleted after this edit was proposed, so the edit was not applied. Propose it again against the current prompt.';
                await this.store.transition(proposalId, 'applied', 'failed', { decidedBy: actorId, failureReason });
                this.logger.warn({ proposalId, promptId: claimed.promptId }, 'Approved saved prompt edit was stale; nothing written');
                throw new Error(failureReason);
            }
            this.logger.info({ proposalId, promptId: claimed.promptId, decidedBy: actorId }, 'Approved saved prompt edit applied');
        }
    }

    /**
     * Render a proposal for the review screen. The title is always set,
     * because the curation hold notification shows the title, or the whole
     * body when there is none.
     *
     * @param proposalId - The proposal the curation item points at.
     * @returns The descriptor the queue renders.
     */
    async describe(proposalId: string): Promise<IContentDescriptor> {
        const proposal = await this.store.get(proposalId);
        let descriptor: IContentDescriptor;
        if (!proposal) {
            descriptor = { title: 'Saved prompt edit (unavailable)', body: 'The proposal record no longer exists.', editable: false };
        } else {
            const prompt = await this.savedPrompts.get(proposal.promptId);
            const current = prompt ? listPromptVariableTokens(prompt.prompt) : [];
            const proposed = listPromptVariableTokens(proposal.proposedPrompt);
            const added = proposed.filter((token) => !current.includes(token));
            let standing: string;
            if (!prompt) {
                standing = 'The prompt has been deleted; approving will fail.';
            } else if (prompt.updatedAt !== proposal.baseUpdatedAt) {
                standing = 'The prompt has changed since this was proposed; approving will fail.';
            } else {
                standing = 'Current — approving replaces the prompt body.';
            }
            descriptor = {
                title: `Saved prompt edit: ${prompt?.name ?? proposal.promptName}`,
                summary: 'Approving replaces this saved prompt\'s body with the proposed text. Its model, tool allowlist, triggers, and owner stay as they are. Only a signed-in admin can approve.',
                body: proposal.proposedPrompt,
                details: [
                    { label: 'Prompt', value: prompt?.name ?? proposal.promptName },
                    { label: 'Reason given', value: proposal.reason || 'No reason was given.' },
                    { label: 'Prompt variables added', value: added.length > 0 ? added.join(', ') : 'none' },
                    { label: 'Proposed by', value: proposal.proposedBy ? `${proposal.source}, user ${proposal.proposedBy}` : proposal.source },
                    { label: 'Standing', value: standing }
                ],
                editable: false
            };
        }
        return descriptor;
    }

    /**
     * Compare a proposal with the prompt as it is now: the body as a line and
     * word diff, and the referenced variables as a list, so an added secret
     * reference stands out on its own.
     *
     * @param proposalId - The proposal the curation item points at.
     * @returns The change set, or null when the proposal or its prompt no longer exists.
     */
    async describeChanges(proposalId: string): Promise<IContentChangeSet | null> {
        const proposal = await this.store.get(proposalId);
        const prompt = proposal ? await this.savedPrompts.get(proposal.promptId) : null;
        let changes: IContentChangeSet | null = null;
        if (proposal && prompt) {
            changes = buildContentChangeSet(
                CHANGE_FIELDS,
                { prompt: prompt.prompt, variables: listPromptVariableTokens(prompt.prompt) },
                { prompt: proposal.proposedPrompt, variables: listPromptVariableTokens(proposal.proposedPrompt) }
            );
        }
        return changes;
    }
}
