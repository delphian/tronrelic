/**
 * @file curation-gate-sink.ts
 *
 * The curation gate expressed as a content-router sink. Curation is the
 * platform's *gate sink family* — the destination that holds an effect for a
 * human decision before it takes hold — so it registers one {@link IContentSink}
 * on the `'content-router'` service. That makes "send this through human review"
 * one routable destination among many (a toast, a tweet) instead of a bespoke
 * call every producer wires by hand, and it lets the central router and its
 * `/system/content-router` introspection see review as a first-class sink.
 *
 * Two capability choices encode what a review gate is. It `accepts` every
 * content (the empty list): a gate holds anything regardless of which descriptor
 * features the content carries, and under the router's `accepts ⊆ present` rule
 * an empty `accepts` is a subset of any descriptor, so the gate always matches.
 * Its `reach` is the narrowest classification (`{ internal, admin }`): review
 * never leaves the platform and only admins act on the queue, so the
 * classification gate (`reach ≤ ceiling`) admits it under any content
 * classification, including the most sensitive.
 *
 * Delivery enqueues through the existing {@link ICurationService.hold} by
 * reference. The pre-rendered descriptor is deliberately ignored: the queue
 * re-derives a live preview from the owning type's `describe()` at hold time, so
 * an operator always sees the current record (and any inline edits) rather than
 * a snapshot frozen at routing time. The type id and opaque ref the gate needs
 * therefore travel in the destination config, the channel the router already
 * reserves for per-destination data.
 */

import type { IContentDescriptor, IContentSink, ICurationService } from '@/types';

/** Sink id for the curation gate, namespaced like a content type. */
export const CURATION_GATE_SINK_ID = 'curation:gate';

/**
 * Build the curation gate sink over a curation service.
 *
 * The service is injected rather than reached through a singleton so the sink is
 * unit-testable against a mock curation service and stays decoupled from how the
 * service is constructed — the same dependency-injection stance the module takes
 * everywhere else.
 *
 * @param curation - The curation service the gate enqueues holds through; the
 *   sink's only collaborator.
 * @returns The content sink that holds delivered content for human review.
 */
export function createCurationGateSink(curation: ICurationService): IContentSink {
    const sink: IContentSink = {
        id: CURATION_GATE_SINK_ID,
        kind: 'gate',
        label: 'Human review (curation)',
        accepts: [],
        reach: { egress: 'internal', audience: 'admin' },

        /**
         * Hold the delivered content for human review by reference. Reads the
         * registered type id and opaque ref from the destination config — not the
         * descriptor — because the queue re-resolves a live preview from the
         * owning type at hold time. Rejects malformed destination config at the
         * boundary so a bad caller fails loudly rather than silently dropping the
         * effect.
         *
         * @param _content - The pre-rendered descriptor, intentionally unused;
         *   the queue re-derives its own preview from the owning type.
         * @param dest - Destination config carrying the curation `typeId`, the
         *   opaque `ref` the type resolves, and an optional `source` attribution.
         * @returns Resolves once the effect is held in the curation queue.
         */
        async deliver(_content: IContentDescriptor, dest: Record<string, unknown>): Promise<void> {
            const typeId = dest.typeId;
            const ref = dest.ref;
            const source = dest.source;

            if (typeof typeId !== 'string' || typeId.length === 0) {
                throw new Error("Curation gate sink requires a non-empty string 'typeId' in the destination config.");
            }
            if (ref === null || typeof ref !== 'object' || Array.isArray(ref)) {
                throw new Error("Curation gate sink requires an object 'ref' in the destination config.");
            }
            if (source !== undefined && typeof source !== 'string') {
                throw new Error("Curation gate sink 'source' must be a string when provided in the destination config.");
            }

            await curation.hold({ typeId, ref: ref as Record<string, unknown>, source });

            return;
        }
    };

    return sink;
}
