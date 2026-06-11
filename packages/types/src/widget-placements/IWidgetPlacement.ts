/**
 * @fileoverview Widget placement record shape.
 *
 * A widget placement is the operator-managed *instance* of a widget
 * type at a particular zone, with optional route filtering and
 * per-instance configuration. Plugin-source placements are
 * automatically created/maintained by the legacy widget-service
 * compatibility shim; operator-source placements are created via the
 * admin API (forthcoming in a future PR).
 *
 * The split between widget *type* (code) and widget *placement* (data)
 * is the structural change PR 2 introduces. Type code change → new
 * deploy required. Placement change → operator action via admin UI,
 * survives plugin disable/re-enable.
 *
 * @module types/widget-placements/IWidgetPlacement
 */

/**
 * Discriminator distinguishing plugin-seeded placements from
 * operator-created placements. Disable behaviour and admin-UI
 * editability vary between the two.
 *
 * - `'plugin'` — Created via the legacy widget-service compatibility
 *   shim when a plugin registers a widget. Soft-disabled (set
 *   `enabled: false`) on plugin disable so operator customisations
 *   to `order` / `routes` / `title` survive the disable/re-enable
 *   cycle.
 * - `'operator'` — Created via the admin API by a human operator.
 *   Lifecycle is independent of any plugin's enable state.
 */
export type PlacementSource = 'plugin' | 'operator';

/**
 * Public-facing placement record. The Mongo document interface
 * extends this with `_id`; the API surface uses the string `id` form.
 */
export interface IWidgetPlacement {
    /** Stable identifier (stringified ObjectId for Mongo-backed rows). */
    readonly id: string;
    /** Widget-type id this placement renders. */
    readonly typeId: string;
    /** Zone id this placement targets. */
    readonly zoneId: string;
    /** Route filter — empty array matches every route. */
    readonly routes: ReadonlyArray<string>;
    /** Sort order within the zone (lower renders first). */
    readonly order: number;
    /** Optional heading rendered above the widget. */
    readonly title?: string;
    /**
     * Optional root-relative URL that turns the rendered heading into a
     * link. Operator-only state — plugins never seed it. Only honoured
     * when {@link title} is also set, since the host chrome links the
     * title text. Validated at the admin boundary to a single-leading-
     * slash internal path (e.g. `/markets`); absolute or off-site URLs
     * are rejected.
     */
    readonly titleUrl?: string;
    /**
     * Per-instance configuration the widget type's data fetcher /
     * component may consume. Validated against the type's
     * `configSchema` if provided (admin UI concern, forthcoming).
     */
    readonly instanceConfig?: Record<string, unknown>;
    /** Whether the placement currently renders. */
    readonly enabled: boolean;
    /** Source discriminator — see {@link PlacementSource}. */
    readonly source: PlacementSource;
    /** Plugin id that owns the placement when `source === 'plugin'`. */
    readonly pluginId?: string;
    /** ISO-8601 creation timestamp. */
    readonly createdAt: string;
    /** ISO-8601 last-update timestamp. */
    readonly updatedAt: string;
}

/**
 * Input shape for placement CRUD. The discriminator and timestamps
 * are populated by the service; the caller supplies the rest.
 */
export interface IPlacementInput {
    typeId: string;
    zoneId: string;
    routes: string[];
    order?: number;
    title?: string;
    /** Optional root-relative link target for the heading. See {@link IWidgetPlacement.titleUrl}. */
    titleUrl?: string;
    instanceConfig?: Record<string, unknown>;
    enabled?: boolean;
}

/**
 * Convenience input shape for plugin-source placements created via
 * the legacy widget-service compatibility shim. Forces `source` and
 * carries the owning plugin id.
 */
export interface IPluginPlacementInput extends IPlacementInput {
    pluginId: string;
}
