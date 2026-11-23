/**
 * @file ProposalCurationQueue.ts
 *
 * The steps every proposed AI edit to this module's configuration takes on
 * its way into and out of the central curation queue, shared by saved-prompt
 * edits and prompt-variable edits so the two cannot drift apart:
 *
 * - Holding a stored proposal for review, and taking it out of `pending` when
 *   the hold fails, because a proposal with no curation item can never be
 *   decided yet would still count against the pending cap.
 * - Withdrawing pending proposals as `superseded` and closing their queue
 *   items, when a newer proposal or a direct admin edit replaces them.
 *
 * What a proposal changes, and what approving it writes, stays with each
 * kind's own edits service.
 */

import type { ICurationService, ISystemLogService } from '@/types';
import { SYSTEM_DECIDER_PREFIX } from '@/types';
import type { IStoredProposal, ProposalStore } from './ProposalStore.js';

/** Decider recorded when a proposal is withdrawn because something newer replaced it. */
export const SUPERSEDED_DECIDED_BY = `${SYSTEM_DECIDER_PREFIX}superseded`;

/** Decider recorded when a proposal is closed because it could not be held for review. */
export const HOLD_FAILED_DECIDED_BY = `${SYSTEM_DECIDER_PREFIX}hold-failed`;

/**
 * Moves one kind of proposal into and out of the curation queue.
 *
 * @typeParam TProposal - The stored record type.
 */
export class ProposalCurationQueue<TProposal extends IStoredProposal> {
    /**
     * @param store - Where this kind of proposal is stored.
     * @param getCuration - Resolves the central curation service at call time,
     *        because curation publishes itself after this module initialises.
     * @param curationTypeId - The curation type this kind is held under.
     * @param label - How log lines name this kind, such as `saved prompt edit`.
     * @param logger - Module logger.
     */
    constructor(
        private readonly store: ProposalStore<TProposal>,
        private readonly getCuration: () => ICurationService | undefined,
        private readonly curationTypeId: string,
        private readonly label: string,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Resolve the curation service, for a caller that must refuse a proposal
     * before storing anything when no curator could ever see it.
     *
     * @returns The curation service, or undefined while it is not published.
     */
    curation(): ICurationService | undefined {
        return this.getCuration();
    }

    /**
     * Hold a proposal that is already stored as `pending`, and record the
     * curation item that holds it. When the hold fails, the proposal is moved
     * to `failed` before the error is rethrown, so it neither shows as waiting
     * nor counts against the cap.
     *
     * @param curation - The curation service the caller resolved.
     * @param proposalId - The stored proposal.
     * @param source - What produced the proposal, for the queue's audit trail.
     * @returns The id of the curation item holding the proposal.
     * @throws Whatever `hold()` threw, after the proposal is marked failed.
     */
    async hold(curation: ICurationService, proposalId: string, source: string): Promise<string> {
        let held: Awaited<ReturnType<ICurationService['hold']>>;
        try {
            held = await curation.hold({ typeId: this.curationTypeId, ref: { proposalId }, source });
        } catch (error) {
            const failureReason = 'The edit could not be held for review, so it is not waiting for a curator. Propose it again.';
            await this.store.transition(proposalId, 'pending', 'failed', { decidedBy: HOLD_FAILED_DECIDED_BY, failureReason });
            this.logger.error({ error, proposalId }, `Could not hold a ${this.label} for curation; the proposal was marked failed`);
            throw error;
        }
        await this.store.setCurationItemId(proposalId, held.id);
        return held.id;
    }

    /**
     * Withdraw the given proposals. Each is marked `superseded` first, then
     * its curation item is rejected under a system decider. The rejection
     * reaches the edits service's decision handler with the proposal no
     * longer pending, so it changes nothing further.
     *
     * @param proposals - The pending proposals to withdraw.
     * @param reason - Logged with each withdrawal.
     * @returns How many were withdrawn.
     */
    async supersede(proposals: TProposal[], reason: string): Promise<number> {
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
                        this.logger.warn({ error, proposalId: proposal.id }, `Could not close the curation item of a superseded ${this.label}`);
                    }
                }
                this.logger.info({ proposalId: proposal.id, reason }, `${capitalize(this.label)} superseded`);
            }
        }
        return count;
    }
}

/** Upper-case the first letter, so a label reads correctly at the start of a log message. */
function capitalize(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
