/**
 * @fileoverview The content router — the in-memory registry of content sinks
 * plus structural candidate matching.
 *
 * One process-lifetime home where any provider registers an `IContentSink` and
 * any pipeline computes, for a content type, the sinks that may act on it. It is
 * a peer of `ContentRegistry` and `HookRegistry`: pure in-memory core
 * infrastructure constructed in bootstrap and published on the service registry
 * as `'content-router'`, not a feature module. The router fans one content type
 * to many sinks (a Recipient List / Dynamic Router), the inverse of a router
 * that picks one branch.
 *
 * The router owns the two routing-layer concerns that are identical for a gate,
 * a toast, and a tweet — registration and structural matching — and delegates
 * the third, authorization, to an injected {@link IClassificationGate} so that
 * seam stays swappable. What a sink's reception *costs* (a human hold, a
 * throttle, a durable outbox) is the sink family's concern and lives in its own
 * module, never here.
 *
 * @see ../../../docs/system/system-content-routing.md — the contract table, the
 *   classification/authorization/structural-routing split, and the
 *   potential-versus-mandated policy layering.
 * @module backend/services/content-router
 */

import type {
    IContentRouter,
    IClassificationGate,
    IContentSink,
    IContentSinkInfo,
    IContentClassification,
    ContentDescriptorFeature,
    ContentSinkDisposer,
    ISystemLogService
} from '@/types';
import { assertValidReach, assertValidAccepts, assertValidSinkKind } from './content-classification.js';

/** Service-registry name the content router is published under. */
export const CONTENT_ROUTER_SERVICE = 'content-router';

/** A registered sink paired with the id of the provider that owns it. */
interface IRegisteredSink {
    sink: IContentSink;
    providerId: string;
}

/**
 * Holds registered sinks keyed by id. Registration validates the sink's `reach`
 * and `accepts` against the governed vocabulary (refusing unknown values
 * fail-fast) and is idempotent per id — re-registering replaces the sink so a
 * plugin hot-reload does not duplicate — and returns a disposer the caller
 * invokes when its owner is torn down. The insertion order of the backing Map is
 * the order `getSinks()` and `list()` report, so callers see a stable ordering.
 */
export class ContentRouter implements IContentRouter {
    private readonly sinks = new Map<string, IRegisteredSink>();

    /**
     * @param gate - The classification gate consulted before structural routing.
     *   Injected so the deferred authorization pass swaps it without touching the
     *   router.
     * @param logger - Scoped logger for registration diagnostics.
     */
    constructor(
        private readonly gate: IClassificationGate,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Register (or replace) a sink, returning a disposer that removes this exact
     * registration. Validates the sink's `reach` and `accepts` first so a
     * malformed sink is rejected at registration rather than silently never
     * matching — mirroring the hook registry refusing a descriptor it did not
     * mint.
     *
     * @param sink - The sink contract a provider owns.
     * @param providerId - Id of the registering plugin or module.
     * @returns A disposer that removes this registration (a no-op if a later
     *          registration of the same id already replaced it).
     */
    register(sink: IContentSink, providerId: string): ContentSinkDisposer {
        assertValidReach(sink.reach);
        assertValidAccepts(sink.accepts);
        assertValidSinkKind(sink.kind);

        const entry: IRegisteredSink = { sink, providerId };
        if (this.sinks.has(sink.id)) {
            this.logger.warn({ sinkId: sink.id }, 'Content sink re-registered; replacing prior sink');
        }
        this.sinks.set(sink.id, entry);
        this.logger.info({ sinkId: sink.id, providerId }, 'Content sink registered');

        return () => {
            // Only remove if this exact registration is still the live one — a
            // later re-registration owns the slot and must not be dropped by an
            // earlier disposer.
            if (this.sinks.get(sink.id) === entry) {
                this.sinks.delete(sink.id);
                this.logger.info({ sinkId: sink.id }, 'Content sink unregistered');
            }
        };
    }

    /**
     * The live registered sinks, in registration order — the raw set the gate
     * filters.
     *
     * @returns The registered sink contracts.
     */
    getSinks(): ReadonlyArray<IContentSink> {
        return Array.from(this.sinks.values()).map((entry) => entry.sink);
    }

    /**
     * List every registered sink for admin and cross-pipeline introspection,
     * without exposing the sink's `deliver` callback.
     *
     * @returns One info record per registered sink.
     */
    list(): IContentSinkInfo[] {
        return Array.from(this.sinks.values()).map((entry) => ({
            id: entry.sink.id,
            kind: entry.sink.kind,
            label: entry.sink.label,
            accepts: entry.sink.accepts,
            reach: entry.sink.reach,
            providerId: entry.providerId
        }));
    }

    /**
     * Run the classification gate over the registered sinks — the admitted set
     * for a content ceiling, before any structural matching.
     *
     * @param classification - The content's exposure ceiling.
     * @returns The admitted sinks.
     */
    admit(classification: IContentClassification): IContentSink[] {
        return this.gate.admit(classification, this.getSinks());
    }

    /**
     * Structural match: the admitted sinks whose every accepted feature is
     * present in the descriptor (`accepts ⊆ present`). This is the *only* routing
     * predicate and is deliberately the containment of `accepts` within the
     * present features — a sink declaring `['body']` matches any content that
     * carries a body, including a content type authored after the sink. (Note the
     * direction: this is `accepts ⊆ present`, the design's rule, not the
     * notifications channel matrix's `present ⊆ accepts` superset check — they
     * are distinct pipelines.) Run over an already-admitted set so it never
     * reasons about egress.
     *
     * @param present - The features the descriptor actually carries.
     * @param admitted - Sinks the gate has already admitted.
     * @returns The structurally matching subset of `admitted`.
     */
    candidates(
        present: ReadonlyArray<ContentDescriptorFeature>,
        admitted: ReadonlyArray<IContentSink>
    ): IContentSink[] {
        const presentSet = new Set(present);
        const matched = admitted.filter((sink) => sink.accepts.every((feature) => presentSet.has(feature)));

        return matched;
    }

    /**
     * The potential sinks for a content type: the gate's admitted set, then the
     * structural match. Composes {@link admit} and {@link candidates} — the
     * router's central computation, the Recipient List the design prescribes.
     *
     * @param classification - The content's exposure ceiling.
     * @param present - The features the descriptor carries.
     * @returns The sinks both admitted and structurally matching.
     */
    route(
        classification: IContentClassification,
        present: ReadonlyArray<ContentDescriptorFeature>
    ): IContentSink[] {
        return this.candidates(present, this.admit(classification));
    }
}
