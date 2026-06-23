/**
 * @fileoverview The classification gate and its authorization policy seam.
 *
 * The gate is the admin-governed step that runs *before* structural routing. It
 * admits a sink only when the sink's `reach` stays within the content's
 * classification ceiling on every dimension (DLP-style containment) and admin
 * policy permits that reach. Lifting this decision out of the sink is the point
 * of the whole design: the "may this leave the building" judgment deserves one
 * answer, and an operator must be able to redirect a class of content without
 * editing sink code.
 *
 * This file ships the gate's shape and direction only. The policy is an
 * allow-all stub; the real model — what an operator expresses, how it is
 * enforced and audited, how it composes with existing egress reasoning — is a
 * later authorization pass that swaps {@link AllowAllRoutingPolicy} behind the
 * unchanged {@link IContentRoutingPolicy} seam without touching the gate, the
 * router, or any sink.
 *
 * @see ../../../docs/system/system-content-routing.md — the gate semantics and
 *   the deferred authorization model.
 * @module backend/services/content-routing-gate
 */

import type {
    IClassificationGate,
    IContentRoutingPolicy,
    IContentClassification,
    IContentSink
} from '@/types';
import { isWithinCeiling } from './content-classification.js';

/**
 * The authorization stub for this slice: every reach is permitted. It exists so
 * the gate has a real collaborator to consult at the correct seam, and so the
 * deferred authorization pass has a single, typed place to land — replace this
 * class, change nothing else. Returning a constant here is the *point*, not an
 * oversight: the design deliberately leaves the authorization seam empty in this
 * slice and fills it later between the seams it establishes now.
 */
export class AllowAllRoutingPolicy implements IContentRoutingPolicy {
    /**
     * Permit delivery at any reach.
     *
     * @param _reach - The exposure a candidate sink causes (ignored by the stub).
     * @returns Always true; a later policy narrows this.
     */
    permits(_reach: IContentClassification): boolean {
        return true;
    }
}

/**
 * The classification gate: filters registered sinks down to those a content
 * ceiling admits. A sink is admitted only when its reach is contained by the
 * ceiling (`reach ≤ classification` on every dimension) *and* the policy permits
 * that reach. Containment direction is load-bearing — the label caps exposure,
 * the inverse of secrecy-clearance "read up" — so a `{ internal, admin }` audit
 * record never becomes a candidate for a `{ external, public }` sink.
 *
 * The gate never reasons about structural `accepts`; that is the router's job,
 * after the gate has run.
 */
export class ClassificationGate implements IClassificationGate {
    /**
     * @param policy - The authorization seam consulted per candidate. Injected
     *   so the deferred authorization pass swaps the implementation without
     *   touching the gate.
     */
    constructor(private readonly policy: IContentRoutingPolicy) {}

    /**
     * Admit the subset of `sinks` whose reach the ceiling contains and the
     * policy permits, preserving input order.
     *
     * @param classification - The content's exposure ceiling.
     * @param sinks - The registered sinks to filter.
     * @returns The admitted sinks.
     */
    admit(classification: IContentClassification, sinks: ReadonlyArray<IContentSink>): IContentSink[] {
        const admitted = sinks.filter(
            (sink) => isWithinCeiling(sink.reach, classification) && this.policy.permits(sink.reach)
        );

        return admitted;
    }
}
