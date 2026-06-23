/**
 * @file IContentRouter.ts
 *
 * The router primitive's contracts: the sink registry, the classification gate
 * seam, and the authorization policy the gate consults. Together they compute
 * the *potential* sinks for a content type — those the gate admits (reach within
 * the content's ceiling, policy permitting) whose structural `accepts` matches
 * the descriptor's present features. This is a Recipient List / Dynamic Router:
 * a fan-to-many dispatcher, not a single-destination router that picks one
 * branch.
 *
 * Three concerns are kept deliberately separate so the routing layer stays a
 * routing layer: classification (the label the content carries), authorization
 * (the gate, governed by {@link IContentRoutingPolicy}), and structural routing
 * (`accepts` over present features). Merging them into one sink-owned predicate
 * is the trap this design avoids — it scatters the "may this leave the building"
 * judgment across every sink and removes the operator's lever to redirect a
 * class of content without editing code.
 *
 * This file ships the gate's *shape and direction only*. The policy is an
 * allow-all stub here; what an operator can express, how it is enforced and
 * audited, and how it composes with existing egress reasoning is a later
 * authorization pass that attaches at this seam.
 *
 * @see ../../../../docs/system/system-content-routing.md — the contract table,
 *   the classification/authorization/structural-routing split, and the
 *   potential-versus-mandated policy layering.
 */

import type { IContentClassification } from './IContentClassification.js';
import type { IContentSink, IContentSinkInfo, ContentDescriptorFeature, ContentSinkDisposer } from './IContentSink.js';

/**
 * The authorization seam the gate consults — the one place the platform answers
 * "may this class of sink ever receive this class of content?" beyond the
 * containment rule. Lifting this decision out of the sink is the whole point:
 * the judgment deserves one answer, and an operator must be able to redirect a
 * class of content ("nothing external for now") without editing sink code.
 *
 * This slice ships an allow-all implementation. The real policy model — what an
 * operator expresses, enforcement, audit — is a deferred authorization pass that
 * replaces the stub behind this unchanged interface.
 */
export interface IContentRoutingPolicy {
    /**
     * Whether admin policy permits delivery at the given reach.
     *
     * @param reach - The exposure a candidate sink causes.
     * @returns True when policy permits that exposure class. The stub returns
     *          true for every reach; a later pass narrows it.
     */
    permits(reach: IContentClassification): boolean;
}

/**
 * The classification gate — a core, admin-governed step that runs *before*
 * routing. It admits a sink only when the sink's `reach` stays within the
 * content's classification ceiling on every dimension *and* policy permits that
 * reach. The containment direction is load-bearing: the label caps where content
 * may go (`reach ≤ classification`), the inverse of secrecy-clearance "read up".
 * A separate interface so the deferred authorization pass can swap the
 * implementation without touching the router or any sink.
 */
export interface IClassificationGate {
    /**
     * Admit the subset of `sinks` whose reach is contained by `classification`
     * on every dimension and whose reach the policy permits.
     *
     * @param classification - The content's exposure ceiling.
     * @param sinks - The registered sinks to filter.
     * @returns The admitted sinks (input order preserved); never reasons about
     *          structural `accepts` — that is the router's job, after the gate.
     */
    admit(classification: IContentClassification, sinks: ReadonlyArray<IContentSink>): IContentSink[];
}

/**
 * The sink registry plus structural candidate matching — the router primitive,
 * published on the service registry as `'content-router'`, a peer of the
 * content-type and hook registries. Registration validates a sink's `reach`
 * against the governed classification vocabulary and refuses an unknown
 * dimension or level (fail-fast). `candidates` is the structural match, run only
 * over already-admitted sinks; `route` composes the gate and the structural
 * match into the potential-sink computation.
 */
export interface IContentRouter {
    /**
     * Register (or replace) a sink, returning a disposer that removes this exact
     * registration. Throws if the sink's `reach` carries an unknown
     * classification dimension or level, or an `accepts` entry that is not a
     * known descriptor feature — mirroring the hook registry refusing a
     * descriptor it did not mint.
     *
     * @param sink - The sink contract a provider owns.
     * @param providerId - Id of the registering plugin or module.
     * @returns A disposer that removes this registration.
     */
    register(sink: IContentSink, providerId: string): ContentSinkDisposer;

    /**
     * The live registered sinks. The raw set the gate filters; callers needing
     * only the introspection projection use {@link list} instead.
     *
     * @returns The registered sinks in registration order.
     */
    getSinks(): ReadonlyArray<IContentSink>;

    /**
     * List every registered sink for admin and cross-pipeline introspection
     * without exposing the sink's `deliver` callback.
     *
     * @returns One info record per registered sink.
     */
    list(): IContentSinkInfo[];

    /**
     * Run the classification gate over the registered sinks — the admitted set
     * for a content ceiling, before any structural matching.
     *
     * @param classification - The content's exposure ceiling.
     * @returns The admitted sinks.
     */
    admit(classification: IContentClassification): IContentSink[];

    /**
     * Structural match: the admitted sinks whose every accepted feature is
     * present in the descriptor (`accepts ⊆ present`). The only routing
     * predicate. Run over an already-admitted set so it never reasons about
     * egress.
     *
     * @param present - The features the descriptor actually carries.
     * @param admitted - Sinks the gate has already admitted.
     * @returns The structurally matching subset of `admitted`.
     */
    candidates(present: ReadonlyArray<ContentDescriptorFeature>, admitted: ReadonlyArray<IContentSink>): IContentSink[];

    /**
     * The potential sinks for a content type: the gate's admitted set, then the
     * structural match. Composes {@link admit} and {@link candidates} — the
     * router's central computation.
     *
     * @param classification - The content's exposure ceiling.
     * @param present - The features the descriptor carries.
     * @returns The sinks both admitted and structurally matching.
     */
    route(classification: IContentClassification, present: ReadonlyArray<ContentDescriptorFeature>): IContentSink[];
}
