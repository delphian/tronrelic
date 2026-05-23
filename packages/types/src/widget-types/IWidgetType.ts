/**
 * @fileoverview Typed descriptor for a declared widget type.
 *
 * A widget type is the *capability* a plugin ships — a renderable
 * component plus the SSR data fetcher that produces its initial
 * payload. Placements are operator-managed records that point at a
 * widget type and decide where it appears, in what order, and with
 * what optional instance configuration.
 *
 * Widget type descriptors are minted by `defineWidgetType(...)` which
 * tracks them in a module-local set so the runtime registry can reject
 * forged descriptors. Plugins do not import `defineWidgetType`
 * directly; they call `context.widgetTypes.register(options)` and the
 * facade constructs the descriptor on their behalf, tagging it with
 * the plugin id.
 *
 * @module types/widget-types/IWidgetType
 */

/**
 * SSR data fetcher signature shared between widget types and the
 * legacy widget service. Receives the resolved route and any params
 * extracted by the host (e.g. `{ address }` on `/u/[address]`) and
 * returns the JSON-serialisable data the frontend component renders.
 *
 * Implementations must return quickly (under 5 s; the resolver enforces
 * a Promise.race timeout) and should not throw — return an empty
 * payload on internal error so a single failing widget cannot drag
 * down the page.
 */
export type WidgetDataFetcher = (
    route: string,
    params: Record<string, string>
) => Promise<unknown>;

/**
 * Immutable descriptor for a single widget type. Returned by
 * `defineWidgetType` and stored in the runtime registry. The frontend
 * widget component registry is keyed by `id`; placement records
 * reference `id` via their `typeId` field.
 *
 * The descriptor is frozen on construction. Mutating it raises a
 * runtime error and breaks the identity check the registry performs
 * at registration time.
 */
export interface IWidgetType {
    /** Dotted, fully qualified id — e.g. `whale-alerts:recent`. */
    readonly id: string;
    /** Short label rendered in admin UIs (palette, placement editor). */
    readonly label: string;
    /** Sentence-length description shown on hover and in admin tooling. */
    readonly description: string;
    /**
     * Optional category for admin-UI palette grouping (e.g.
     * `'analytics'`, `'social'`). Unused at runtime.
     */
    readonly category?: string;
    /**
     * SSR data fetcher invoked by the resolver. Receives the route
     * and params extracted by the host and returns the JSON payload
     * the frontend component renders.
     */
    readonly defaultDataFetcher: WidgetDataFetcher;
    /**
     * Optional schema describing the operator-editable instance
     * configuration this widget type accepts. Reserved for the
     * admin placement editor in a future PR; today the resolver
     * does not forward instanceConfig anywhere, so this field is
     * informational only.
     */
    readonly configSchema?: unknown;
}

/**
 * Initialisation options accepted by `defineWidgetType`.
 *
 * Plugins pass the same shape to `context.widgetTypes.register(...)` —
 * the facade constructs the descriptor on their behalf so plugin
 * code never imports `defineWidgetType` directly.
 */
export interface IDefineWidgetTypeOptions {
    /** Dotted, fully qualified id. Must be unique across the process. */
    id: string;
    /** Short label for admin UIs. */
    label: string;
    /** Sentence-length description. */
    description: string;
    /** Optional category for admin-UI palette grouping. */
    category?: string;
    /** SSR data fetcher. See {@link WidgetDataFetcher}. */
    defaultDataFetcher: WidgetDataFetcher;
    /** Optional instance-config schema. Informational in this PR. */
    configSchema?: unknown;
}

/**
 * Disposer returned from widget-type registration. Calling it removes
 * the type from the runtime registry — placements pointing at the
 * removed type resolve to "type unavailable" and the resolver skips
 * them silently. Plugin-owned types are bulk-disposed by the plugin
 * loader on `disable()`; the disposer is exposed for finer-grained
 * control but not required for correctness.
 */
export type WidgetTypeRegisterDisposer = () => void;
