/**
 * @file IConversationGroup.ts
 *
 * One row of the conversation rail: a run of history records sharing a
 * `conversationId`, collapsed to the fields the rail needs to name, date, and
 * badge the conversation without loading its turns.
 */

import type { IAiQueryRecord } from '@/types';

/** A run of consecutive history records sharing one `conversationId`. */
export interface IConversationGroup {
    conversationId: string;
    turns: number;
    firstPrompt: string;
    lastAt: string;
    /**
     * Execution mode of the group's latest turn, taken from the first record
     * encountered (newest-first). Drives the `Scheduled` badge so an operator
     * can tell an autonomous cron run apart from a query they typed — the only
     * cross-mode distinction the grouped list surfaces.
     */
    mode: IAiQueryRecord['mode'];
    /**
     * Terminal status of the group's latest turn, taken from the first record
     * encountered (newest-first). Without it the list cannot say whether a run
     * succeeded, so a failed scheduled prompt looked identical to a clean one
     * and an operator had to reopen every conversation to find the failure. A
     * group whose older turns failed but whose latest succeeded reads as
     * `completed`, which is consistent with `mode` and `lastAt` already
     * describing the newest turn rather than the whole run.
     *
     * `incomplete` is the third value: the query itself worked but the run
     * stopped before producing a usable answer. That case used to be stored and
     * shown as `completed`, which is what let a scheduled prompt appear to run
     * cleanly every night while producing nothing.
     */
    status: IAiQueryRecord['status'];
    /**
     * What kind of ending the latest turn had, when the record carries one.
     * Absent on rows written before the field existed, in which case the row
     * falls back to `status` alone.
     */
    outcome: IAiQueryRecord['outcome'];
    /**
     * Why that latest turn produced no clean answer, or null when it did.
     * Carried on the group so the row can explain a failed or incomplete run on
     * hover, rather than making the operator open the conversation to read one
     * sentence.
     */
    errorMessage: string | null;
    /**
     * Estimated total USD cost of the conversation, summed across every priced
     * turn at the rates captured when each turn ran. `null` when not a single
     * turn could be priced, so the row shows a dash rather than a misleading
     * $0.00 — mirrors the live transcript's sum-or-hide behavior.
     */
    costUsd: number | null;
}
