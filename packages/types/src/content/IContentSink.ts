/**
 * @file IContentSink.ts
 *
 * A capability-registered consumer of content — the back-end of the router's
 * narrow waist. A sink declares the descriptor features it can render
 * (`accepts`) and the exposure it causes (`reach`), then renders the canonical
 * {@link IContentDescriptor} to its own wire shape in `deliver()`. It never
 * names a content type and never runs a routing predicate of its own: the
 * platform authorizes it by `reach` and matches it by `accepts`, so a sink can
 * act on a content type authored after it without either side knowing the
 * other's identity. That is the decoupling the router exists to provide.
 *
 * `accepts` is the *only* routing predicate (never `typeId`, never
 * classification). It is matched structurally at dispatch: a sink is a candidate
 * when every feature it accepts is present in the descriptor. `reach` is data
 * the gate reads before routing, never a branch the sink runs.
 *
 * @see ../../../../docs/system/system-content-routing.md — the sink contract,
 *   the structural-routing rule, and the graceful-degradation (unknown-type)
 *   invariant every sink must pass.
 */

import type { IContentDescriptor } from './IContentDescriptor.js';
import type { IContentClassification } from './IContentClassification.js';

/**
 * The renderable descriptor slots a sink can render, matched structurally
 * against the features a descriptor actually carries — the router's sole routing
 * predicate. `details` is the human-readable facts table; the governed typed
 * `fields` map is deliberately absent, because it is enrichment a sink reads by
 * key via `readContentField`, never a slot whose presence gates routing. Derived
 * from the tuple so the type and the runtime feature list stay aligned.
 */
export const CONTENT_DESCRIPTOR_FEATURES = ['title', 'body', 'media', 'details'] as const;

/**
 * One renderable descriptor feature. A sink's `accepts` is a list of these.
 */
export type ContentDescriptorFeature = typeof CONTENT_DESCRIPTOR_FEATURES[number];

/**
 * The sink families the router serves, made machine-readable. The design names
 * three kinds of consumer — a `gate` holds content for a human decision
 * (curation), a `delivery` sink hands content to a user-facing family pipeline
 * (a notification channel), a `publish` sink is a terminal destination an
 * operator selects to push content outward (a Twitter outlet, the internal
 * publish log). Reach says *how far* a sink exposes content; `kind` says *what
 * role* it plays, which reach alone cannot encode (a gate and an audit log can
 * share `{ internal, admin }` reach yet are not interchangeable destinations).
 *
 * The kind exists because a selecting pipeline must filter by role, not just by
 * structural match. The curation destination picker surfaces only `publish`
 * sinks: offering the `gate` sink would re-enqueue the very item being approved
 * (an infinite hold loop), and offering a match-only `delivery` sink whose
 * `deliver()` throws would fail at send. Governed like the rest of the
 * vocabulary — registration refuses an unknown kind, fail-fast.
 */
export const CONTENT_SINK_KINDS = ['gate', 'delivery', 'publish'] as const;

/**
 * One sink family role. Declared on every {@link IContentSink}; validated at
 * registration against {@link CONTENT_SINK_KINDS}.
 */
export type ContentSinkKind = typeof CONTENT_SINK_KINDS[number];

/**
 * Disposer returned by {@link IContentRouter.register}. A sink-providing plugin
 * calls it from `disable()` so its sink vanishes when the plugin is turned off;
 * a module registers for the process lifetime and keeps it only for symmetry.
 */
export type ContentSinkDisposer = () => void;

/**
 * A consumer of content registered against the router by capability. The
 * platform discovers it, authorizes it by `reach`, matches it by `accepts`, and
 * dispatches the descriptor to `deliver()`; the sink names no content type.
 */
export interface IContentSink {
    /** Stable sink id, namespaced like a content type (`<provider>:<name>`). */
    id: string;

    /**
     * The sink's family role — `gate`, `delivery`, or `publish`. A selecting
     * pipeline filters on this to offer only the right kind of destination (the
     * curation picker shows `publish` sinks only); the router validates it at
     * registration. Data the sink declares, never a predicate it runs.
     */
    kind: ContentSinkKind;

    /**
     * Optional human-readable name for admin surfaces — the destination picker
     * and the `/system/content-router` introspection. Consumers fall back to the
     * `id` when it is absent, so a sink that omits it still renders.
     */
    label?: string;

    /**
     * The descriptor features this sink consumes to render — the structural
     * routing predicate. A sink is a candidate for a descriptor only when every
     * feature it accepts is present. Declaring `['body']` makes the sink a
     * candidate for any content that carries a body, including types authored
     * after the sink.
     */
    accepts: ContentDescriptorFeature[];

    /**
     * The exposure delivering through this sink causes, in the governed
     * classification vocabulary. Read by the gate (`reach ≤ classification`),
     * never branched on by the sink. A Twitter sink is `{ external, public }`;
     * an internal audit sink is `{ internal, admin }`.
     */
    reach: IContentClassification;

    /**
     * Render the canonical descriptor to this sink's wire shape and deliver it.
     * Reads only the descriptor and the admin-supplied destination config —
     * never the underlying payload, never the content type's id. Per-destination
     * idempotency and retry are the sink family's concern, not the router's.
     *
     * @param content - The canonical intermediate representation to render.
     * @param dest - Admin-supplied destination config (a handle, a chat id).
     * @returns Resolves when the sink has accepted the content for delivery.
     */
    deliver(content: IContentDescriptor, dest: Record<string, unknown>): Promise<void>;
}

/**
 * Summary of a registered sink, for admin and cross-pipeline introspection
 * without exposing the sink's `deliver` callback — the analog of
 * {@link IContentTypeInfo} for the content-type registry.
 */
export interface IContentSinkInfo {
    /** The sink id. */
    id: string;

    /** The sink's family role — `gate`, `delivery`, or `publish`. */
    kind: ContentSinkKind;

    /** Optional human-readable name; consumers fall back to `id` when absent. */
    label?: string;

    /** The descriptor features the sink consumes. */
    accepts: ContentDescriptorFeature[];

    /** The exposure the sink causes. */
    reach: IContentClassification;

    /** Id of the registering plugin or module. */
    providerId: string;
}
