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
import { SYSTEM_DECIDER_PREFIX, isSignedInCuratorId } from '@/types';
import { buildContentChangeSet } from '../../../services/buildContentChangeSet.js';
import type { SavedPromptProposalStore } from './saved-prompt-proposal-store.js';
import type { SavedPromptsService } from './saved-prompts.service.js';
import { listPromptVariableTokens } from './prompt-variable-registry.js';

/** Curation type id proposals are held under; the propose tool binds its `curationTypeId` to it. */
export const SAVED_PROMPT_EDIT_CURATION_TYPE_ID = 'ai-tools:saved-prompt-edit';

/** Decider recorded when a proposal is withdrawn because something newer replaced it. */
export const SUPERSEDED_DECIDED_BY = `${SYSTEM_DECIDER_PREFIX}superseded`;

/** Decider recorded when a proposal is closed because it could not be held for review. */
export const HOLD_FAILED_DECIDED_BY = `${SYSTEM_DECIDER_PREFIX}hold-failed`;

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
    /**
     * @param store - Proposal records.
     * @param savedPrompts - The prompt library an approval writes to.
     * @param getCuration - Resolves the central curation service at call time,
     *        because curation publishes itself after this module initialises.
     * @param logger - Module logger.
     */
    constructor(
        private readonly store: SavedPromptProposalStore,
        private readonly savedPrompts: Pick<SavedPromptsService, 'get' | 'updatePromptIfUnchanged'>,
        private readonly getCuration: () => ICurationService | undefined,
        private readonly logger: ISystemLogService
    ) {}

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
        const curation = this.getCuration();
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
        const olderPending = await this.store.listPendingForPrompt(prompt.id);
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
        const supersededCount = await this.supersedeProposals(olderPending, 'A newer proposal for the same prompt replaced it.');
        await this.store.insert(proposal);
        // A proposal whose hold failed has no curation item, so no curator can
        // ever decide it, yet `listPending` would still present it for review
        // and `countPending` would charge it against the cap. Take the record
        // out of `pending` before reporting the failure to the caller.
        let held: Awaited<ReturnType<ICurationService['hold']>>;
        try {
            held = await curation.hold({
                typeId: SAVED_PROMPT_EDIT_CURATION_TYPE_ID,
                ref: { proposalId: proposal.id },
                source: input.source
            });
        } catch (error) {
            const failureReason = 'The edit could not be held for review, so it is not waiting for a curator. Propose it again.';
            await this.store.transition(proposal.id, 'pending', 'failed', { decidedBy: HOLD_FAILED_DECIDED_BY, failureReason });
            this.logger.error({ error, proposalId: proposal.id, promptId: prompt.id }, 'Could not hold a saved prompt edit for curation; the proposal was marked failed');
            throw error;
        }
        await this.store.setCurationItemId(proposal.id, held.id);
        this.logger.info({ proposalId: proposal.id, promptId: prompt.id, curationId: held.id, supersededCount }, 'Saved prompt edit proposed and held for curation');

        const current = listPromptVariableTokens(prompt.prompt);
        const proposed = listPromptVariableTokens(proposedPrompt);
        return {
            proposal: { ...proposal, curationItemId: held.id },
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
        const pending = await this.store.listPendingForPrompt(promptId);
        return this.supersedeProposals(pending, reason);
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

    /**
     * Withdraw the given proposals. Each is marked `superseded` first, then
     * its curation item is rejected under a system decider. The rejection
     * reaches `applyDecision` with the proposal no longer pending, so it
     * changes nothing further.
     *
     * @param proposals - The pending proposals to withdraw.
     * @param reason - Logged with each withdrawal.
     * @returns How many were withdrawn.
     */
    private async supersedeProposals(proposals: ISavedPromptProposal[], reason: string): Promise<number> {
        let count = 0;
        for (const proposal of proposals) {
            const withdrawn = await this.store.transition(proposal.id, 'pending', 'superseded', { decidedBy: SUPERSEDED_DECIDED_BY });
            if (withdrawn) {
                count += 1;
                if (proposal.curationItemId) {
                    try {
                        await this.getCuration()?.reject(proposal.curationItemId, SUPERSEDED_DECIDED_BY);
                    } catch (error) {
                        // The proposal is already withdrawn; a curator who
                        // approves the stale queue item later gets a no-op.
                        this.logger.warn({ error, proposalId: proposal.id }, 'Could not close the curation item of a superseded prompt edit');
                    }
                }
                this.logger.info({ proposalId: proposal.id, promptId: proposal.promptId, reason }, 'Saved prompt edit superseded');
            }
        }
        return count;
    }
}
