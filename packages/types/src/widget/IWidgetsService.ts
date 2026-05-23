/**
 * @fileoverview Unified widget service interface.
 *
 * `IWidgetsService` is the single public surface for the widget
 * subsystem. It is registered as `'widgets'` on the service registry
 * during `WidgetsModule.run()`; every consumer — plugins, core
 * modules, admin controllers, the SSR router — reaches widget
 * functionality through this interface.
 *
 * Identity is trust-based: every registration call requires an
 * `ownerId` argument (a plugin manifest id, or the literal `'core'`
 * for core registrations). The service does not inspect the caller —
 * trust boundaries are enforced at import time and at the plugin
 * loader, the same way every other service on the registry behaves.
 *
 * @module types/widget/IWidgetsService
 */

import type { WidgetDataFetcher } from '../widget-types/IWidgetType.js';
import type { IZoneSnapshot } from '../widget-zones/IZoneRegistry.js';
import type { IWidgetTypeSnapshot } from '../widget-types/IWidgetTypeRegistry.js';
import type { ZoneHost, ZoneLayout } from '../widget-zones/IZoneDescriptor.js';
import type {
    IWidgetPlacement,
    IPlacementInput
} from '../widget-placements/IWidgetPlacement.js';
import type {
    IPlacementListFilter,
    IPlacementPatch
} from '../widget-placements/IPlacementService.js';
import type { IWidgetData } from './IWidgetData.js';

/**
 * Disposer returned by a `register*` call. Invoking it removes that
 * specific registration — use it when a caller needs manual,
 * fine-grained cleanup. For bulk teardown of every type, zone, and
 * placement an owner registered, call
 * `unregisterAllForOwner(ownerId)`; the registries dispose by
 * ownerId, so there is no disposer ledger to maintain. The plugin
 * lifecycle calls `unregisterAllForOwner` on disable.
 */
export type WidgetsRegistrationDisposer = () => void;

/**
 * Input to `registerType`. Plain options object — the service mints
 * the internal descriptor.
 */
export interface IRegisterWidgetTypeInput {
    /** Globally unique id — convention: `<owner-id>:<widget-name>`. */
    id: string;
    /** Human label rendered in the admin picker and as a fallback heading. */
    label: string;
    /** Sentence-length description rendered in the admin picker. */
    description: string;
    /** Optional admin grouping label. */
    category?: string;
    /**
     * Called at SSR time with the request route and params. Must
     * return JSON-serialisable data quickly — a 5-second per-fetcher
     * timeout is enforced. On throw, timeout, or non-serialisable
     * result the widget is logged and silently omitted from the
     * rendered output; it is not replaced with an empty-data
     * placeholder.
     */
    defaultDataFetcher: WidgetDataFetcher;
    /** Optional informational schema for the per-placement instanceConfig. */
    configSchema?: unknown;
}

/**
 * Input to `registerZone`. Plain options object — the service mints
 * the internal descriptor.
 */
export interface IRegisterZoneInput {
    /** Globally unique id — convention: `<owner-id>:<zone-name>`. */
    id: string;
    /** Human label rendered in the admin picker. */
    label: string;
    /** Sentence-length description rendered in the admin picker. */
    description: string;
    /** Host classification — drives admin grouping. */
    host: ZoneHost;
    /** Layout hint for the zone container. Defaults to `'vertical'`. */
    layout?: ZoneLayout;
}

/**
 * Input to `registerWidget` — the common convenience that registers a
 * widget type and creates its default plugin-source placement in one
 * call. Extends `IRegisterWidgetTypeInput` with the default placement
 * parameters operators may later override.
 */
export interface IRegisterWidgetInput extends IRegisterWidgetTypeInput {
    /** Zone the default placement targets. */
    defaultZoneId: string;
    /** Default route filter — empty array matches every route. */
    defaultRoutes: string[];
    /** Default render order — lower renders first. Defaults to `100`. */
    defaultOrder?: number;
    /** Optional default heading override. */
    defaultTitle?: string;
    /** Optional default per-instance config. */
    defaultInstanceConfig?: Record<string, unknown>;
}

/**
 * Unified widget service published on the service registry as
 * `'widgets'`. The single public entry point for every widget
 * operation in the system.
 */
export interface IWidgetsService {
    // ------------------------------------------------------------
    // Discovery
    // ------------------------------------------------------------

    /** Snapshot of every registered zone, grouped by host. */
    listZones(): IZoneSnapshot;

    /** Snapshot of every registered widget type, grouped by owning plugin. */
    listTypes(): IWidgetTypeSnapshot;

    /** True when a zone with the given id is registered. */
    hasZone(zoneId: string): boolean;

    /** True when a widget type with the given id is registered. */
    hasType(typeId: string): boolean;

    /**
     * Resolve the widgets to render for a given route. Queries the
     * enabled placement set, runs each matching type's data fetcher in
     * parallel under a 5-second timeout, and returns the bundle sorted
     * by zone then order. Failures within a fetcher are logged and the
     * widget is omitted from the response — they never throw out.
     *
     * The SSR entry point used by `/api/widgets`.
     */
    fetchWidgetsForRoute(
        route: string,
        params?: Record<string, string>
    ): Promise<IWidgetData[]>;

    // ------------------------------------------------------------
    // Registration (write — identity-bearing)
    // ------------------------------------------------------------

    /**
     * Register a widget type owned by `ownerId`. Returns a disposer
     * that removes the registration; the disposer is also implicit in
     * `unregisterAllForOwner`. No placement is created — use
     * {@link registerWidget} when you want both.
     *
     * @param input - Type descriptor parameters.
     * @param ownerId - Plugin manifest id, or `'core'` for core types.
     * @throws Error if the type id is already owned by a different owner.
     */
    registerType(
        input: IRegisterWidgetTypeInput,
        ownerId: string
    ): WidgetsRegistrationDisposer;

    /**
     * Register a zone owned by `ownerId`. Returns a disposer.
     *
     * @param input - Zone descriptor parameters.
     * @param ownerId - Plugin manifest id, or `'core'` for core zones.
     * @throws Error if the zone id is already owned by a different owner.
     */
    registerZone(
        input: IRegisterZoneInput,
        ownerId: string
    ): WidgetsRegistrationDisposer;

    /**
     * Convenience: register a widget type and atomically upsert its
     * default plugin-source placement. The common one-call form used
     * by plugins shipping a widget.
     *
     * Re-callable: subsequent calls with the same `(ownerId, id)` set
     * `enabled: true` on the existing placement row without touching
     * `order`, `routes`, `title`, or `instanceConfig` — operator
     * customisations survive every enable cycle.
     *
     * The original default parameters are cached so
     * `restorePluginDefaults` can revert operator changes later.
     *
     * @param input - Type descriptor parameters plus default placement.
     * @param ownerId - Plugin manifest id. Must not be `'core'` — only
     *   plugins create plugin-source placements.
     */
    registerWidget(
        input: IRegisterWidgetInput,
        ownerId: string
    ): Promise<void>;

    /**
     * Tear down everything `ownerId` registered: soft-disable every
     * plugin-source placement, dispose every owned type, dispose every
     * owned zone. Operator customisations to plugin-source placements
     * survive on disk for the next enable cycle. Called by the plugin
     * lifecycle on disable and uninstall.
     *
     * Safe to call with `ownerId === 'core'` — core registrations are
     * never disposed, the call is a no-op.
     */
    unregisterAllForOwner(ownerId: string): Promise<void>;

    // ------------------------------------------------------------
    // Placement CRUD (operator surface)
    // ------------------------------------------------------------

    /**
     * List placements with optional filter. Used by the admin UI and
     * any consumer auditing placement state.
     */
    listPlacements(
        filter?: IPlacementListFilter
    ): Promise<ReadonlyArray<IWidgetPlacement>>;

    /** Find a single placement by id, or `null` if absent. */
    findPlacementById(id: string): Promise<IWidgetPlacement | null>;

    /**
     * Create a new operator-source placement. Plugin-source rows are
     * only created through {@link registerWidget}.
     *
     * @throws Error if `typeId` or `zoneId` does not match a registered
     *   type/zone.
     */
    createPlacement(input: IPlacementInput): Promise<IWidgetPlacement>;

    /**
     * Update operator-editable fields of any placement (plugin-source
     * or operator-source). Returns `null` when no row matches.
     *
     * @throws Error if patch references an unknown `zoneId`.
     */
    updatePlacement(
        id: string,
        patch: IPlacementPatch
    ): Promise<IWidgetPlacement | null>;

    /**
     * Permanently delete a placement. Plugin-source rows are refused —
     * use {@link unregisterAllForOwner} or update `{enabled: false}`
     * to remove a plugin row from display.
     *
     * @returns True when a row was deleted, false otherwise.
     * @throws Error when the target is a plugin-source row.
     */
    deletePlacement(id: string): Promise<boolean>;

    /**
     * Reset a plugin-source placement to the original arguments the
     * plugin passed to `registerWidget`. Re-enables the row and clears
     * operator overrides on `zoneId`, `routes`, `order`, `title`.
     * `instanceConfig` is operator state and is preserved.
     *
     * @throws Error when the placement is not plugin-source, or when
     *   the plugin's defaults are not cached in this process (re-enable
     *   the plugin to repopulate).
     */
    restorePluginDefaults(id: string): Promise<IWidgetPlacement | null>;
}
