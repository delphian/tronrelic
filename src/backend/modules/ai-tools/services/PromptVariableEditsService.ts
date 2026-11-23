/**
 * @file PromptVariableEditsService.ts
 *
 * Proposed edits to the text of admin-authored (static) prompt variables,
 * reviewed in the central curation queue. A variable's text is spliced into
 * every prompt that references `{%name%}`, so one change reaches all of them
 * on their next run. An AI tool may suggest new text, but the change is held
 * in `/system/curation` under `ai-tools:prompt-variable-edit` and written only
 * when a signed-in admin approves it.
 *
 * Rules this service owns:
 * - Only a static variable's text changes. Its name, description, category,
 *   and sensitivity are never part of a proposal, and built-in (dynamic)
 *   variables have no stored text to change.
 * - A `secret` variable cannot be proposed against. The read tools withhold
 *   its value, and a proposal would show the old value in the review diff.
 * - One pending proposal per variable. A newer one, or a direct edit,
 *   reclassification, or delete on `/system/ai-tools`, withdraws the older one.
 * - An approval writes only if the variable still carries the `updatedAt` the
 *   proposal was based on; otherwise the proposal is marked `failed`.
 */

import { randomUUID } from 'node:crypto';
import type {
    IContentChangeSet,
    IContentDescriptor,
    ICurationService,
    IPromptVariableProposal,
    ISavedPrompt,
    IStaticPromptVariable,
    ISystemLogService
} from '@/types';
import { isSignedInCuratorId } from '@/types';
import { buildContentChangeSet } from '../../../services/buildContentChangeSet.js';
import type { ProposalStore } from './ProposalStore.js';
import { ProposalCurationQueue } from './ProposalCurationQueue.js';
import { listPromptVariableTokens, type PromptVariableRegistry } from './prompt-variable-registry.js';

/** Curation type id proposals are held under; the propose tool binds its `curationTypeId` to it. */
export const PROMPT_VARIABLE_EDIT_CURATION_TYPE_ID = 'ai-tools:prompt-variable-edit';

/** Collection prompt-variable edit proposals are stored in (manual `module_<id>_` prefix). */
export const PROMPT_VARIABLE_PROPOSALS_COLLECTION = 'module_ai-tools_variable_proposals';

/** Most proposals allowed to wait for a curator at once, so a looping agent cannot flood the queue. */
export const MAX_PENDING_VARIABLE_PROPOSALS = 20;

/** The fields a curator compares. */
const CHANGE_FIELDS = [{ name: 'content', label: 'Variable text' }] as const;

/** What a caller supplies to propose an edit. */
export interface IPromptVariableEditProposalInput {
    /** Name of the static variable to change, without the `{% %}` delimiters. */
    variableName: string;
    /** The full text the variable should hold after approval. */
    proposedContent: string;
    /** Why the change is wanted, shown to the curator. */
    reason: string;
    /** What produced the proposal, for the audit trail. */
    source: string;
    /** User id of the person whose session proposed it, when known. */
    proposedBy?: string;
}

/** What a successful proposal reports back to the tool. */
export interface IPromptVariableEditProposalResult {
    /** The stored proposal. */
    proposal: IPromptVariableProposal;
    /** How many older pending proposals for the same variable were withdrawn. */
    supersededCount: number;
    /** Names of the saved prompts whose body references the variable, so the proposer knows what the change reaches. */
    referencedBy: string[];
}

/** Thrown for a proposal the caller can fix, such as an unknown variable or unchanged text. */
export class PromptVariableEditError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PromptVariableEditError';
    }
}

/**
 * Orchestrates proposing, deciding, and withdrawing prompt-variable edits.
 */
export class PromptVariableEditsService {
    /** Holds and withdraws proposals in the curation queue. */
    private readonly queue: ProposalCurationQueue<IPromptVariableProposal>;

    /**
     * @param store - Proposal records, in {@link PROMPT_VARIABLE_PROPOSALS_COLLECTION}.
     * @param variables - The variable registry an approval writes to.
     * @param listSavedPrompts - Reads the saved-prompt library, so the review
     *        screen and the tool can say which prompts the change reaches.
     * @param getCuration - Resolves the central curation service at call time,
     *        because curation publishes itself after this module initialises.
     * @param logger - Module logger.
     */
    constructor(
        private readonly store: ProposalStore<IPromptVariableProposal>,
        private readonly variables: Pick<PromptVariableRegistry, 'getStatic' | 'updateStaticContentIfUnchanged'>,
        private readonly listSavedPrompts: () => Promise<ISavedPrompt[]>,
        getCuration: () => ICurationService | undefined,
        private readonly logger: ISystemLogService
    ) {
        this.queue = new ProposalCurationQueue(store, getCuration, PROMPT_VARIABLE_EDIT_CURATION_TYPE_ID, 'prompt variable edit', logger);
    }

    /**
     * Store a proposal, withdraw any older pending one for the same variable,
     * and hold the new one for a curator.
     *
     * @param input - The variable, the proposed text, and attribution.
     * @returns The proposal and the saved prompts the change reaches.
     * @throws PromptVariableEditError when the variable is unknown, built-in, or
     *         secret, the text is empty or unchanged, too many proposals are
     *         waiting, or curation is unavailable.
     */
    async propose(input: IPromptVariableEditProposalInput): Promise<IPromptVariableEditProposalResult> {
        const curation = this.queue.curation();
        if (!curation) {
            throw new PromptVariableEditError('The curation service is unavailable, so the edit cannot be held for review.');
        }
        const variable = this.variables.getStatic(input.variableName);
        if (!variable) {
            throw new PromptVariableEditError(`No admin-authored variable is named "${input.variableName.slice(0, 64)}". Built-in variables compute their value in code and cannot be edited.`);
        }
        if (variable.sensitivity === 'secret') {
            throw new PromptVariableEditError(`{%${variable.name}%} is classified secret, so its text cannot be read or proposed against. An admin can edit it on /system/ai-tools.`);
        }
        // The text is compared and stored exactly as sent: a variable's
        // leading or trailing line breaks are part of how it splices into a
        // prompt, and a direct save keeps them too.
        if (!input.proposedContent.trim()) {
            throw new PromptVariableEditError('The proposed text is empty.');
        }
        if (input.proposedContent === variable.content) {
            throw new PromptVariableEditError('The proposed text is identical to the current text, so there is nothing to review.');
        }
        const olderPending = await this.store.listPendingFor(variable.name);
        // Superseding frees a slot, so an agent revising its own proposal is
        // never blocked by the cap it is already counted against.
        if (await this.store.countPending() - olderPending.length >= MAX_PENDING_VARIABLE_PROPOSALS) {
            throw new PromptVariableEditError(`${MAX_PENDING_VARIABLE_PROPOSALS} variable edits are already waiting for review. Ask an admin to decide them before proposing more.`);
        }

        const proposal: IPromptVariableProposal = {
            id: randomUUID(),
            variableName: variable.name,
            baseUpdatedAt: variable.updatedAt,
            proposedContent: input.proposedContent,
            reason: input.reason.trim(),
            source: input.source,
            ...(input.proposedBy ? { proposedBy: input.proposedBy } : {}),
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        const supersededCount = await this.queue.supersede(olderPending, 'A newer proposal for the same variable replaced it.');
        await this.store.insert(proposal);
        const curationItemId = await this.queue.hold(curation, proposal.id, input.source);
        this.logger.info({ proposalId: proposal.id, variable: variable.name, curationId: curationItemId, supersededCount }, 'Prompt variable edit proposed and held for curation');

        return {
            proposal: { ...proposal, curationItemId },
            supersededCount,
            referencedBy: await this.promptsReferencing(variable.name)
        };
    }

    /**
     * Withdraw every pending proposal for a variable. Called when an admin
     * edits, reclassifies, or deletes the variable directly, because the
     * proposal was based on a version that no longer exists and approving it
     * would fail anyway.
     *
     * @param variableName - The variable that changed.
     * @param reason - Logged with each withdrawal.
     * @returns How many proposals were withdrawn.
     */
    async supersedeForVariable(variableName: string, reason: string): Promise<number> {
        const pending = await this.store.listPendingFor(variableName);
        return this.queue.supersede(pending, reason);
    }

    /**
     * List every pending proposal, for the Variables section's notice.
     *
     * @returns The pending proposals, newest first.
     */
    async listPending(): Promise<IPromptVariableProposal[]> {
        return this.store.listPending();
    }

    /**
     * Apply a curator's decision. Curation records the decision before it
     * calls this, so the method must be safe to repeat: a proposal no longer
     * pending is left alone.
     *
     * @param proposalId - The proposal the curation item points at.
     * @param decision - Which way the curator decided.
     * @param actorId - The curator's user id, from the curation commit context.
     * @returns Resolves once the decision is applied or found to be stale.
     * @throws When an approval has no signed-in curator, or the variable changed since the proposal.
     */
    async applyDecision(proposalId: string, decision: 'applied' | 'rejected', actorId: string | undefined): Promise<void> {
        if (decision === 'rejected') {
            const rejected = await this.store.transition(proposalId, 'pending', 'rejected', { decidedBy: actorId });
            if (!rejected) {
                this.logger.info({ proposalId }, 'Prompt variable edit rejection no-op: proposal missing or no longer pending');
            }
        } else {
            await this.applyApproval(proposalId, actorId);
        }
    }

    /**
     * The approval half of {@link applyDecision}: claim the proposal by moving
     * it to `applied` so two approvals cannot both write, write if the variable
     * is unchanged, and turn the claim into `failed` when it moved on.
     *
     * @param proposalId - The proposal being approved.
     * @param actorId - The approving curator's user id.
     * @returns Resolves once the text is written or the approval is found to be a no-op.
     * @throws When there is no signed-in curator, or the variable changed since the proposal.
     */
    private async applyApproval(proposalId: string, actorId: string | undefined): Promise<void> {
        // Curation refuses this already for a type that requires a signed-in
        // curator. Checking again here keeps the write safe if the type is
        // ever decided through another path.
        if (!actorId || !isSignedInCuratorId(actorId)) {
            throw new Error('Only a signed-in admin can approve a prompt variable edit.');
        }
        const claimed = await this.store.transition(proposalId, 'pending', 'applied', { decidedBy: actorId });
        if (!claimed) {
            this.logger.info({ proposalId }, 'Prompt variable edit approval no-op: proposal missing or no longer pending');
        } else {
            const written = await this.variables.updateStaticContentIfUnchanged(
                claimed.variableName,
                claimed.baseUpdatedAt,
                claimed.proposedContent
            );
            if (!written) {
                const failureReason = 'The variable was changed, reclassified, or deleted after this edit was proposed, so the edit was not applied. Propose it again against the current text.';
                await this.store.transition(proposalId, 'applied', 'failed', { decidedBy: actorId, failureReason });
                this.logger.warn({ proposalId, variable: claimed.variableName }, 'Approved prompt variable edit was stale; nothing written');
                throw new Error(failureReason);
            }
            this.logger.info({ proposalId, variable: claimed.variableName, decidedBy: actorId }, 'Approved prompt variable edit applied');
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
            descriptor = { title: 'Prompt variable edit (unavailable)', body: 'The proposal record no longer exists.', editable: false };
        } else {
            const variable = this.variables.getStatic(proposal.variableName);
            const referencedBy = await this.promptsReferencing(proposal.variableName);
            descriptor = {
                title: `Prompt variable edit: {%${proposal.variableName}%}`,
                summary: `Approving replaces this variable's text. Every prompt that references {%${proposal.variableName}%} gets the new text on its next run. Its name, description, category, and sensitivity stay as they are. Only a signed-in admin can approve.`,
                body: proposal.proposedContent,
                details: [
                    { label: 'Variable', value: `{%${proposal.variableName}%}` },
                    { label: 'Reason given', value: proposal.reason || 'No reason was given.' },
                    { label: 'Used by saved prompts', value: referencedBy.length > 0 ? referencedBy.join(', ') : 'none' },
                    { label: 'Proposed by', value: proposal.proposedBy ? `${proposal.source}, user ${proposal.proposedBy}` : proposal.source },
                    { label: 'Standing', value: describeStanding(variable, proposal) }
                ],
                editable: false
            };
        }
        return descriptor;
    }

    /**
     * Compare a proposal with the variable's text as it is now, as a line and
     * word diff.
     *
     * @param proposalId - The proposal the curation item points at.
     * @returns The change set, or null when the proposal or its variable no longer exists.
     */
    async describeChanges(proposalId: string): Promise<IContentChangeSet | null> {
        const proposal = await this.store.get(proposalId);
        const variable = proposal ? this.variables.getStatic(proposal.variableName) : undefined;
        let changes: IContentChangeSet | null = null;
        if (proposal && variable) {
            changes = buildContentChangeSet(
                CHANGE_FIELDS,
                { content: variable.content },
                { content: proposal.proposedContent }
            );
        }
        return changes;
    }

    /**
     * Name the saved prompts whose body references a variable, so a reviewer
     * sees how far an approval reaches. A failed read leaves the list empty
     * rather than failing the proposal or the review screen.
     *
     * @param variableName - The variable name, without delimiters.
     * @returns Saved prompt names, in library order.
     */
    private async promptsReferencing(variableName: string): Promise<string[]> {
        const token = `{%${variableName}%}`;
        let names: string[] = [];
        try {
            names = (await this.listSavedPrompts())
                .filter((prompt) => listPromptVariableTokens(prompt.prompt).includes(token))
                .map((prompt) => prompt.name);
        } catch (error) {
            this.logger.warn({ error, variable: variableName }, 'Could not list the saved prompts that reference a prompt variable');
        }
        return names;
    }
}

/**
 * Say whether approving a proposal would still apply, for the review screen.
 *
 * @param variable - The variable as it is now, if it still exists.
 * @param proposal - The proposal being reviewed.
 * @returns One sentence for the Standing row.
 */
function describeStanding(variable: IStaticPromptVariable | undefined, proposal: IPromptVariableProposal): string {
    let standing = 'Current — approving replaces the variable\'s text.';
    if (!variable) {
        standing = 'The variable has been deleted; approving will fail.';
    } else if (variable.updatedAt !== proposal.baseUpdatedAt) {
        standing = 'The variable has changed since this was proposed; approving will fail.';
    }
    return standing;
}
