/**
 * @fileoverview Widget placement service interface.
 *
 * `IPlacementService` owns the placement collection — CRUD operations
 * plus the route-based query the resolver uses to populate SSR. The
 * legacy widget-service compatibility shim calls
 * `ensurePluginPlacement` on plugin enable and `softDisableForPlugin`
 * on plugin disable; the admin API surface (future PR) drives the
 * generic CRUD methods.
 *
 * Soft-disable semantics: plugin-source placements with `enabled:
 * false` survive plugin disable, preserving operator customisations
 * to `order` / `routes` / `title` for the next re-enable. Hard delete
 * is reserved for operator action via admin UI.
 *
 * @module types/widget-placements/IPlacementService
 */

import type {
    IWidgetPlacement,
    IPlacementInput,
    IPluginPlacementInput
} from './IWidgetPlacement.js';

/**
 * Filter accepted by `list`. Future admin UI will narrow listings by
 * zone, plugin, or source.
 */
export interface IPlacementListFilter {
    zoneId?: string;
    pluginId?: string;
    source?: 'plugin' | 'operator';
    enabledOnly?: boolean;
}

/**
 * Patch shape for `update`. Any subset of operator-editable fields.
 *
 * Title supports an explicit clear: `title: null` removes the field
 * (`$unset`) so the placement falls back to the widget-type label.
 * Omitting `title` from the patch leaves the existing value unchanged.
 * `title: ''` is rejected at the controller boundary so blank cannot
 * sneak in through clients that drop empty strings.
 *
 * `titleUrl` follows the same three-state convention as `title`:
 * a string sets the heading link, `null` clears it (`$unset`), and
 * omission leaves it unchanged.
 */
export interface IPlacementPatch {
    zoneId?: string;
    /**
     * Reparent the placement. A string attaches it to that
     * `core:layout-group` container (forcing its `zoneId` to the parent's
     * zone and clearing `routes`); `null` detaches it back to the zone
     * (`$unset`); omission leaves the current parent unchanged. Mirrors
     * the three-state convention used by `title`/`titleUrl`. See
     * {@link IWidgetPlacement.parentId} for the one-level nesting rule.
     */
    parentId?: string | null;
    routes?: string[];
    order?: number;
    /**
     * Set the placement's relative row width as a flex weight, or clear it
     * back to auto width with `null` (`$unset`). Omission leaves the
     * current width unchanged — the same three-state convention as
     * `title`/`titleUrl`. See {@link IWidgetPlacement.layoutWeight}.
     */
    layoutWeight?: number | null;
    title?: string | null;
    titleUrl?: string | null;
    instanceConfig?: Record<string, unknown>;
    enabled?: boolean;
}

/**
 * Process-wide placement service. One implementation per process,
 * created during `WidgetsModule.init()` with the injected
 * `IDatabaseService`.
 */
export interface IPlacementService {
    /**
     * Ensure a plugin-source placement exists for the given plugin +
     * widget-type combination. On first call, creates a placement
     * with all input fields and `enabled: true`. On subsequent calls
     * (e.g. plugin re-enable after disable), finds the existing row
     * and sets `enabled: true` without overwriting other fields —
     * operator customisations to `order` / `routes` / `title` survive.
     *
     * Called by the legacy widget-service compatibility shim during
     * plugin install / enable / init.
     *
     * @param input - Plugin placement parameters.
     * @returns The resulting placement record (created or re-enabled).
     */
    ensurePluginPlacement(input: IPluginPlacementInput): Promise<IWidgetPlacement>;

    /**
     * Soft-disable every plugin-source placement for the given plugin
     * by setting `enabled: false`. Operator-source placements are
     * untouched. Called by `PluginManagerService` on plugin disable
     * and uninstall.
     *
     * @param pluginId - Plugin whose placements should be disabled.
     * @returns Count of placements modified.
     */
    softDisableForPlugin(pluginId: string): Promise<number>;

    /**
     * Find all placements relevant to the given route, sorted by
     * `(zoneId asc, order asc)`. Includes only `enabled: true` rows.
     * Route matching is exact: an empty `routes` array matches every
     * route; otherwise the route must appear in the array.
     *
     * @param route - Request path the host derived from the URL.
     * @returns Matching placements in deterministic render order.
     */
    findByRoute(route: string): Promise<ReadonlyArray<IWidgetPlacement>>;

    /**
     * Create a new placement. Operator-source by default unless
     * `source` is provided. Used by the admin API.
     *
     * @param input - Full placement input.
     * @param options - Source discriminator and optional plugin id.
     * @returns The created record.
     */
    create(
        input: IPlacementInput,
        options?: { source?: 'plugin' | 'operator'; pluginId?: string }
    ): Promise<IWidgetPlacement>;

    /**
     * Update a placement's operator-editable fields by id.
     *
     * @param id - Placement id (stringified ObjectId).
     * @param patch - Subset of editable fields.
     * @returns The updated record, or `null` when no placement with
     *   that id exists.
     */
    update(id: string, patch: IPlacementPatch): Promise<IWidgetPlacement | null>;

    /**
     * Permanently delete a placement by id. Reserved for operator
     * action — plugin lifecycle uses {@link softDisableForPlugin}
     * instead so customisations survive disable/re-enable.
     *
     * @param id - Placement id.
     * @returns True when a row was removed; false when no match.
     */
    delete(id: string): Promise<boolean>;

    /**
     * Find a single placement by id.
     *
     * @param id - Placement id.
     * @returns The record, or `null` when no match.
     */
    findById(id: string): Promise<IWidgetPlacement | null>;

    /**
     * List placements with optional filter. Used by the admin UI.
     *
     * @param filter - Optional narrow.
     * @returns Placements in `(zoneId asc, order asc)` order.
     */
    list(filter?: IPlacementListFilter): Promise<ReadonlyArray<IWidgetPlacement>>;

    /**
     * Replace operator-editable fields on a plugin-source placement
     * with the plugin's original registration args and re-enable the
     * row. Used by the admin "restore plugin defaults" endpoint.
     *
     * Callers are responsible for verifying the placement is
     * plugin-source and for resolving the plugin defaults — the
     * service applies the patch atomically and broadcasts a
     * `placement:restored` event.
     *
     * @param id - Placement id (stringified ObjectId).
     * @param defaults - Plugin defaults to apply.
     * @returns Updated placement, or null when no row matches.
     */
    restoreToPluginDefaults(
        id: string,
        defaults: {
            zoneId: string;
            routes: ReadonlyArray<string>;
            order: number;
            title?: string;
        }
    ): Promise<IWidgetPlacement | null>;

    /**
     * Detach every child of a container placement, clearing their
     * `parentId` so they fall back to direct children of the zone. Used
     * when a `core:layout-group` container is deleted: rather than
     * cascade-deleting its children (and losing operator config), the
     * service relocates them to the zone at their existing order.
     *
     * @param parentId - The container placement id whose children detach.
     * @returns Count of child placements detached.
     */
    detachChildrenOf(parentId: string): Promise<number>;
}
