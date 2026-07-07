/**
 * @file syndication-service.ts
 *
 * The durable publish-delivery engine — the transactional-outbox / async-relay /
 * idempotent-receiver stack the content-routing design prescribes for external
 * publishing. It replaces in-process best-effort fan-out (a bare
 * `Promise.allSettled` in the request path, which loses effects on a crash) with
 * a durable outbox a background relay drains, retries with backoff, and dead-
 * letters on exhaustion.
 *
 * Why durable rather than best-effort: an external publish is a real side effect.
 * If the process dies mid-fan-out, a best-effort caller has no record to retry
 * from — a dual-write hazard. Writing one outbox row per leg makes the *intent*
 * durable; the relay makes the *delivery* durable and observable. The honest
 * contract is at-least-once plus idempotency (effectively-once): each leg is an
 * independent at-least-once delivery, there is no atomic saga across external
 * APIs, and the per-leg idempotency key lets a sink that can dedupe avoid a
 * double-post on retry.
 *
 * Every database touch flows through {@link IDatabaseService} convenience methods
 * — enqueue is idempotent via a unique index plus duplicate-key catch, and the
 * relay claims a leg with a compare-and-swap `updateMany` — so the engine carries
 * no raw-driver coupling and is exercised entirely against the mock database.
 *
 * @see ../../../../docs/system/system-content-routing.md — the durable-delivery
 *   design and the at-least-once contract.
 * @see ../README.md — the prescriptive module reference (schema, relay loop,
 *   backoff curve, dead-letter, curation integration).
 * @module modules/syndication/services/syndication-service
 */

import { randomUUID } from 'node:crypto';
import type {
    IContentRouter,
    IContentSink,
    IDatabaseService,
    IHookRegistry,
    ISyndicationEnqueueResult,
    ISyndicationLegView,
    ISyndicationRequest,
    ISyndicationService,
    ISyndicationStats,
    ISystemLogService,
    SyndicationLegStatus
} from '@/types';
import {
    SYNDICATION_OUTBOX_COLLECTION,
    type ISyndicationOutboxDocument
} from '../database/ISyndicationOutboxDocument.js';
import { HOOKS } from '../../../hooks/registry.js';
import { backoffMs } from './syndication-backoff.js';

/** Default retry budget — a leg dead-letters after this many attempts. */
export const DEFAULT_MAX_ATTEMPTS = 8;

/** Maximum legs the relay claims and delivers per tick, bounding one run's work. */
export const RELAY_BATCH_LIMIT = 25;

/**
 * How long a leg may sit in `delivering` before the relay treats it as crash-
 * orphaned and reclaims it for retry. Longer than any healthy `deliver` call, so
 * a slow-but-live delivery is never reclaimed out from under itself.
 */
export const CLAIM_STALE_MS = 5 * 60_000;

/** Tunable knobs, all defaulted; surfaced for tests rather than env (no new prod vars). */
export interface ISyndicationServiceOptions {
    /** Retry budget per leg. */
    maxAttempts?: number;
    /** Legs claimed per relay tick. */
    batchLimit?: number;
    /** Stale-claim reclaim threshold in ms. */
    claimStaleMs?: number;
}

/**
 * The durable syndication engine. One instance constructed by
 * {@link SyndicationModule} and published as `'syndication'`; not a per-consumer
 * utility, so it is a single shared instance like the curation and notification
 * services.
 */
export class SyndicationService implements ISyndicationService {
    private readonly maxAttempts: number;
    private readonly batchLimit: number;
    private readonly claimStaleMs: number;

    /**
     * @param logger - Module-scoped logger.
     * @param database - Core database holding the outbox collection.
     * @param contentRouter - The live sink registry; the relay resolves a leg's
     *        sink by id at delivery time so a sink registered (or re-enabled)
     *        after enqueue still delivers.
     * @param hookRegistry - The core hook registry the relay invokes
     *        `scheduler.legDelivered` on after a successful delivery, so
     *        subscribers can audit or react to the delivered content.
     * @param options - Optional tuning overrides; all default.
     */
    constructor(
        private readonly logger: ISystemLogService,
        private readonly database: IDatabaseService,
        private readonly contentRouter: IContentRouter,
        private readonly hookRegistry: IHookRegistry,
        options?: ISyndicationServiceOptions
    ) {
        this.maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
        this.batchLimit = options?.batchLimit ?? RELAY_BATCH_LIMIT;
        this.claimStaleMs = options?.claimStaleMs ?? CLAIM_STALE_MS;
    }

    /**
     * Create the outbox indexes: a unique index on `idempotencyKey` (the enqueue-
     * idempotency guarantee — a duplicate insert fails with 11000 rather than
     * double-creating a leg), a `{ status, nextAttemptAt }` index for the relay's
     * due-leg scan, and an `originId` index for a consumer's overlay lookup.
     * Called once from module init; safe to re-run.
     *
     * @returns Resolves when the indexes exist.
     */
    async ensureIndexes(): Promise<void> {
        await this.database.createIndex(SYNDICATION_OUTBOX_COLLECTION, { idempotencyKey: 1 }, { unique: true });
        await this.database.createIndex(SYNDICATION_OUTBOX_COLLECTION, { status: 1, nextAttemptAt: 1 });
        await this.database.createIndex(SYNDICATION_OUTBOX_COLLECTION, { originId: 1 });
    }

    /**
     * Derive the stable `(originId, sinkId)` idempotency key. Identical across
     * every retry of the same leg and across a re-enqueue of the same request, so
     * it is both the enqueue-dedupe key (unique index) and the receiver-dedupe key
     * handed to a sink.
     *
     * @param originId - The originating record id.
     * @param sinkId - The destination sink id.
     * @returns The idempotency key.
     */
    private idempotencyKey(originId: string, sinkId: string): string {
        return `${originId}::${sinkId}`;
    }

    /**
     * Durably enqueue one outbox row per leg. Idempotent on `(originId, sinkId)`:
     * an insert that collides with the unique index is swallowed and the existing
     * leg's id returned, so an originator may safely retry the enqueue after a
     * crash without double-creating a leg. Rows start `pending` and immediately
     * eligible (`nextAttemptAt = now`) so the next relay tick picks them up.
     *
     * @param request - The descriptor, origin identity, and destination legs.
     * @returns The full leg set (new and pre-existing) with ids.
     */
    async enqueue(request: ISyndicationRequest): Promise<ISyndicationEnqueueResult> {
        const now = new Date();
        const legIds: string[] = [];

        for (const leg of request.legs) {
            const key = this.idempotencyKey(request.originId, leg.sinkId);
            const doc: ISyndicationOutboxDocument = {
                _id: randomUUID(),
                idempotencyKey: key,
                originId: request.originId,
                originKind: request.originKind,
                typeId: request.typeId,
                ref: request.ref,
                sinkId: leg.sinkId,
                descriptor: request.descriptor,
                dest: leg.dest ?? {},
                status: 'pending',
                attempts: 0,
                maxAttempts: this.maxAttempts,
                nextAttemptAt: now,
                createdAt: now,
                updatedAt: now
            };

            try {
                await this.database.insertOne(SYNDICATION_OUTBOX_COLLECTION, doc);
                legIds.push(doc._id);
            } catch (error) {
                // A unique-index collision means this leg is already enqueued — the
                // idempotent path. Resolve the existing row's id; any other error
                // is a real fault and propagates.
                if (this.isDuplicateKeyError(error)) {
                    const existing = await this.database.findOne<ISyndicationOutboxDocument>(
                        SYNDICATION_OUTBOX_COLLECTION,
                        { idempotencyKey: key }
                    );
                    legIds.push(existing?._id ?? doc._id);
                } else {
                    throw error;
                }
            }
        }

        this.logger.info(
            { originId: request.originId, originKind: request.originKind, legs: legIds.length },
            'Syndication legs enqueued'
        );

        return { enqueued: legIds.length, legIds };
    }

    /**
     * One relay tick: reclaim crash-orphaned `delivering` legs, then claim and
     * deliver up to a bounded batch of due legs. Robust by construction — every
     * leg's claim-and-deliver is isolated so one fault never aborts the batch — so
     * the scheduler can call it on a fixed cadence and trust it to make forward
     * progress without supervision.
     *
     * @returns The number of legs whose delivery was attempted this tick.
     */
    async runRelayOnce(): Promise<number> {
        await this.reclaimStaleClaims();

        const due = await this.findDueLegs();
        let attempted = 0;
        for (const leg of due) {
            try {
                const claimed = await this.claimAndDeliver(leg);
                if (claimed) {
                    attempted += 1;
                }
            } catch (error) {
                // A claim/delivery fault for one leg must not abort the tick; the
                // leg stays claimable (or is left mid-claim and reclaimed as stale)
                // and the next tick retries it.
                this.logger.error({ error, legId: leg._id }, 'Syndication relay leg failed unexpectedly');
            }
        }

        return attempted;
    }

    /**
     * Return crash-orphaned legs — those left `delivering` longer than the stale
     * threshold by a process that died mid-attempt — to `failed` so the relay
     * retries them. This is the at-least-once leg of the contract: a leg whose
     * external call may or may not have landed is retried, and the sink's
     * idempotency key is what prevents a double-effect.
     *
     * @returns Resolves when stale claims are reset.
     */
    private async reclaimStaleClaims(): Promise<void> {
        const cutoff = new Date(Date.now() - this.claimStaleMs);
        const reclaimed = await this.database.updateMany<ISyndicationOutboxDocument>(
            SYNDICATION_OUTBOX_COLLECTION,
            { status: 'delivering', updatedAt: { $lt: cutoff } },
            { $set: { status: 'failed', nextAttemptAt: new Date(), updatedAt: new Date() } }
        );
        if (reclaimed > 0) {
            this.logger.warn({ reclaimed }, 'Reclaimed crash-orphaned syndication legs for retry');
        }
    }

    /**
     * Read the due legs for this tick — `pending` or `failed` legs whose
     * `nextAttemptAt` has passed — oldest-due first and bounded by the batch limit.
     *
     * @returns The due outbox rows.
     */
    private async findDueLegs(): Promise<ISyndicationOutboxDocument[]> {
        return this.database.find<ISyndicationOutboxDocument>(
            SYNDICATION_OUTBOX_COLLECTION,
            { status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: new Date() } },
            { sort: { nextAttemptAt: 1 }, limit: this.batchLimit }
        );
    }

    /**
     * Atomically claim one due leg and deliver it. The claim is a compare-and-swap
     * `updateMany` filtered on the leg's current `status` and `attempts`, so two
     * overlapping relay ticks can never both win the same leg — exactly one
     * observes a modified count of 1, because the loser's filter no longer matches
     * once the winner has advanced `attempts`. The claim sets `attempts` to its
     * known next value (rather than `$inc`) so the new count is deterministic; the
     * atomicity comes from the CAS filter, not the increment operator. The value
     * after the claim is this delivery's 1-based attempt number, handed to the sink
     * for idempotency.
     *
     * @param leg - A due leg observed by {@link findDueLegs}.
     * @returns True when this caller won the claim and attempted delivery.
     */
    private async claimAndDeliver(leg: ISyndicationOutboxDocument): Promise<boolean> {
        const claimToken = randomUUID();
        const attempt = leg.attempts + 1;
        const won = await this.database.updateMany<ISyndicationOutboxDocument>(
            SYNDICATION_OUTBOX_COLLECTION,
            { _id: leg._id, status: leg.status, attempts: leg.attempts },
            { $set: { status: 'delivering', claimToken, attempts: attempt, updatedAt: new Date() } }
        );
        if (won !== 1) {
            // Another tick claimed it first; leave it to that tick.
            return false;
        }

        const sink = this.resolveSink(leg.sinkId);
        if (!sink) {
            // The sink is not registered right now (a disabled plugin). Treat as a
            // retryable failure, not a permanent one, so re-enabling the plugin
            // within the retry window delivers; the budget still dead-letters it if
            // the sink never returns.
            await this.settleFailureOrDead(leg, claimToken, attempt, `sink '${leg.sinkId}' is not registered`);
            return true;
        }

        try {
            const result = await sink.deliver(leg.descriptor, leg.dest, {
                idempotencyKey: leg.idempotencyKey,
                attempt
            });
            if (result && typeof result === 'object' && result.refused) {
                // A settled "will not" — terminal, never retried.
                await this.settleTerminal(leg._id, claimToken, 'refused', { reason: result.reason });
            } else {
                const settled = await this.settleTerminal(leg._id, claimToken, 'delivered', {});
                // Announce the successful sinking so subscribers can audit, count,
                // or fan out — carrying the sink, the delivered descriptor, and the
                // provider coordinates (typeId + ref) needed to load the full
                // record. Observer semantics isolate reactor failures: the invoke
                // never throws back into the relay, so a misbehaving subscriber
                // cannot re-open or duplicate a settled delivery.
                //
                // Gate on the terminal CAS: fire only when this attempt actually
                // settled the row (modified count 1). If its claim was reclaimed as
                // stale and re-won by a later tick, the settle is a no-op and this
                // losing attempt must stay silent — the winning tick fires the hook —
                // so a slow-sink/multi-instance race cannot emit a duplicate or false
                // delivered event.
                if (settled === 1) {
                    await this.hookRegistry.invoke(HOOKS.scheduler.legDelivered, {
                        sinkId: leg.sinkId,
                        sinkLabel: sink.label,
                        typeId: leg.typeId,
                        ref: leg.ref,
                        descriptor: leg.descriptor,
                        legId: leg._id,
                        originId: leg.originId,
                        originKind: leg.originKind,
                        idempotencyKey: leg.idempotencyKey,
                        attempt
                    });
                }
            }
        } catch (error) {
            await this.settleFailureOrDead(leg, claimToken, attempt, error instanceof Error ? error.message : String(error));
        }

        return true;
    }

    /**
     * Resolve a leg's sink from the live router by id. Returns undefined when no
     * sink with that id is currently registered.
     *
     * @param sinkId - The destination sink id.
     * @returns The sink, or undefined when not registered.
     */
    private resolveSink(sinkId: string): IContentSink | undefined {
        return this.contentRouter.getSinks().find((sink) => sink.id === sinkId);
    }

    /**
     * Record a terminal outcome (`delivered` or `refused`) for a leg, clearing the
     * claim token. Terminal states are never reconsidered by the relay.
     *
     * Guarded on `claimToken` so a slow worker whose claim was reclaimed as stale
     * and re-claimed by a later tick cannot overwrite the new active attempt: its
     * token no longer matches, so this write is a no-op. Clearing `claimToken` on
     * settle is safe because `reclaimStaleClaims` keys on `status`/`updatedAt`, not
     * the token.
     *
     * @param legId - The leg id.
     * @param claimToken - The token minted by this attempt's claim; the CAS guard
     *        that scopes the write to the attempt that is still the live owner.
     * @param status - The terminal status to set.
     * @param patch - Extra fields (a `reason` for a refusal).
     * @returns The number of legs the CAS modified: 1 when this attempt was still
     *        the live owner and settled the row, 0 when its claim had been
     *        superseded (a stale-token no-op). The delivered branch gates its
     *        `legDelivered` hook on this so a losing attempt stays silent.
     */
    private async settleTerminal(
        legId: string,
        claimToken: string,
        status: Extract<SyndicationLegStatus, 'delivered' | 'refused'>,
        patch: { reason?: string }
    ): Promise<number> {
        return this.database.updateMany<ISyndicationOutboxDocument>(
            SYNDICATION_OUTBOX_COLLECTION,
            { _id: legId, claimToken },
            { $set: { status, claimToken: undefined, updatedAt: new Date(), ...patch } }
        );
    }

    /**
     * Record a failed attempt: schedule a backed-off retry while the budget holds,
     * or dead-letter the leg once it is exhausted. Dead-lettering is terminal and
     * surfaces on the operator dashboard; a backed-off `failed` leg re-enters the
     * due scan when its `nextAttemptAt` passes.
     *
     * Guarded on `claimToken` so a slow worker whose claim was reclaimed as stale
     * and re-claimed by a later tick cannot overwrite the new active attempt: its
     * token no longer matches, so this write is a no-op. Clearing `claimToken` is
     * safe because `reclaimStaleClaims` keys on `status`/`updatedAt`, not the token.
     *
     * @param leg - The leg as observed before the claim (carries `maxAttempts`).
     * @param claimToken - The token minted by this attempt's claim; the CAS guard
     *        that scopes the write to the attempt that is still the live owner.
     * @param attempt - The 1-based attempt number that just failed.
     * @param errorMessage - The failure message recorded for the operator.
     * @returns Resolves when the leg is updated.
     */
    private async settleFailureOrDead(
        leg: ISyndicationOutboxDocument,
        claimToken: string,
        attempt: number,
        errorMessage: string
    ): Promise<void> {
        const now = new Date();
        if (attempt >= leg.maxAttempts) {
            await this.database.updateMany<ISyndicationOutboxDocument>(
                SYNDICATION_OUTBOX_COLLECTION,
                { _id: leg._id, claimToken },
                { $set: { status: 'dead', claimToken: undefined, lastError: errorMessage, updatedAt: now } }
            );
            this.logger.error(
                { legId: leg._id, sinkId: leg.sinkId, attempt, error: errorMessage },
                'Syndication leg dead-lettered after exhausting retries'
            );
        } else {
            await this.database.updateMany<ISyndicationOutboxDocument>(
                SYNDICATION_OUTBOX_COLLECTION,
                { _id: leg._id, claimToken },
                {
                    $set: {
                        status: 'failed',
                        claimToken: undefined,
                        lastError: errorMessage,
                        nextAttemptAt: new Date(now.getTime() + backoffMs(attempt)),
                        updatedAt: now
                    }
                }
            );
            this.logger.warn(
                { legId: leg._id, sinkId: leg.sinkId, attempt, error: errorMessage },
                'Syndication leg failed; scheduled for retry'
            );
        }
    }

    /**
     * The current state of every leg for one originating record, newest first —
     * the overlay source a consumer reads to show live delivery state.
     *
     * @param originId - The originating record id.
     * @returns The leg views.
     */
    async getLegs(originId: string): Promise<ISyndicationLegView[]> {
        const docs = await this.database.find<ISyndicationOutboxDocument>(
            SYNDICATION_OUTBOX_COLLECTION,
            { originId },
            { sort: { createdAt: -1 } }
        );
        return docs.map((doc) => this.toView(doc));
    }

    /**
     * Batched {@link getLegs}: one query for many origins, grouped by `originId`.
     * Origins with no legs are simply absent from the result.
     *
     * @param originIds - The originating record ids to look up.
     * @returns A map of `originId` to its leg views.
     */
    async getLegsForOrigins(originIds: string[]): Promise<Record<string, ISyndicationLegView[]>> {
        const result: Record<string, ISyndicationLegView[]> = {};
        if (originIds.length === 0) {
            return result;
        }
        const docs = await this.database.find<ISyndicationOutboxDocument>(
            SYNDICATION_OUTBOX_COLLECTION,
            { originId: { $in: originIds } },
            { sort: { createdAt: -1 } }
        );
        for (const doc of docs) {
            (result[doc.originId] ??= []).push(this.toView(doc));
        }
        return result;
    }

    /**
     * The dead-lettered legs awaiting operator attention, newest first.
     *
     * @param limit - Maximum legs to return.
     * @returns The dead-lettered leg views.
     */
    async listDeadLettered(limit = 100): Promise<ISyndicationLegView[]> {
        const docs = await this.database.find<ISyndicationOutboxDocument>(
            SYNDICATION_OUTBOX_COLLECTION,
            { status: 'dead' },
            { sort: { updatedAt: -1 }, limit }
        );
        return docs.map((doc) => this.toView(doc));
    }

    /**
     * Return a dead-lettered leg to the queue with a fresh retry budget — the
     * operator's manual recovery after fixing the failure cause. CAS-guarded on
     * `status: 'dead'` so it is a no-op for any leg not actually dead-lettered.
     *
     * @param legId - The leg to retry.
     * @returns True when a dead-lettered leg was requeued.
     */
    async retry(legId: string): Promise<boolean> {
        const now = new Date();
        const modified = await this.database.updateMany<ISyndicationOutboxDocument>(
            SYNDICATION_OUTBOX_COLLECTION,
            { _id: legId, status: 'dead' },
            { $set: { status: 'pending', attempts: 0, nextAttemptAt: now, lastError: undefined, updatedAt: now } }
        );
        const requeued = modified === 1;
        if (requeued) {
            this.logger.info({ legId }, 'Dead-lettered syndication leg requeued by operator');
        }
        return requeued;
    }

    /**
     * Per-status leg counts for the operator dashboard.
     *
     * @returns The counts across all lifecycle states.
     */
    async getStats(): Promise<ISyndicationStats> {
        const statuses: SyndicationLegStatus[] = ['pending', 'delivering', 'delivered', 'refused', 'failed', 'dead'];
        const counts = await Promise.all(
            statuses.map((status) =>
                this.database.count<ISyndicationOutboxDocument>(SYNDICATION_OUTBOX_COLLECTION, { status })
            )
        );
        return {
            pending: counts[0],
            delivering: counts[1],
            delivered: counts[2],
            refused: counts[3],
            failed: counts[4],
            dead: counts[5]
        };
    }

    /**
     * Project an outbox row to its wire view, stamping dates as ISO strings.
     *
     * @param doc - The stored outbox row.
     * @returns The leg view.
     */
    private toView(doc: ISyndicationOutboxDocument): ISyndicationLegView {
        return {
            legId: doc._id,
            originId: doc.originId,
            originKind: doc.originKind,
            sinkId: doc.sinkId,
            status: doc.status,
            attempts: doc.attempts,
            maxAttempts: doc.maxAttempts,
            nextAttemptAt: doc.nextAttemptAt ? new Date(doc.nextAttemptAt).toISOString() : undefined,
            lastError: doc.lastError,
            reason: doc.reason,
            idempotencyKey: doc.idempotencyKey,
            createdAt: new Date(doc.createdAt).toISOString(),
            updatedAt: new Date(doc.updatedAt).toISOString()
        };
    }

    /**
     * Whether an error is a MongoDB duplicate-key (11000) error — the signal that
     * an enqueue collided with an already-present leg (the idempotent path).
     *
     * @param error - The caught error.
     * @returns True when it is a duplicate-key error.
     */
    private isDuplicateKeyError(error: unknown): boolean {
        return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
    }
}
