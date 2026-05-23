import type {
    IWidgetService,
    IWidgetConfig,
    IWidgetData,
    ISystemLogService,
    IZoneRegistry,
    IWidgetTypeRegistry,
    IPlacementService
} from '@/types';
import { defineWidgetType } from '../../modules/widgets/widget-types/define-widget-type.js';
import type { PlacementResolver } from '../../modules/widgets/placements/placement-resolver.js';

/**
 * Fallback set used for zone validation when no `IZoneRegistry` has
 * been injected yet — covers test paths that instantiate the service
 * without bootstrap wiring. Production always overrides this via
 * `setZoneRegistry(...)` immediately after bootstrap constructs the
 * registry, so this set mirrors the registry's declared core zones.
 */
const FALLBACK_VALID_ZONES = new Set([
    'ticker-after',
    'main-before',
    'main-after',
    'plugin-content:before',
    'plugin-content:after'
]);

/** Default order applied when input omits one. */
const DEFAULT_ORDER = 100;

/**
 * Compatibility-shim widget service.
 *
 * PR 2 reshapes the plugin-facing widget API: instead of an in-memory
 * registry, plugin registrations are split into a widget-type
 * declaration (against `IWidgetTypeRegistry`) plus a plugin-source
 * placement (against `IPlacementService`). The shim translates the
 * legacy `IWidgetService` calls into this new shape so the five
 * existing plugins (and any third-party plugin shipping against the
 * old API) keep working without code change.
 *
 * Operational modes:
 *
 * - **Wired** (production): every method delegates to the new
 *   widget-type / placement services. `WidgetsModule.init()` calls
 *   the `setWidgetTypeRegistry`/`setPlacementService`/`setPlacementResolver`
 *   setters once during bootstrap.
 * - **Unwired** (tests that don't construct `WidgetsModule`): the
 *   legacy in-memory Map of widgets is consulted for the existing
 *   sync admin reads and for `fetchWidgetsForRoute`. This preserves
 *   the 27 unit tests in `widget.service.test.ts` without forcing
 *   each to mock the new infrastructure.
 *
 * The dual mode is temporary — PR 3 removes the legacy code path and
 * the `IWidgetService` interface alongside the rest of the legacy
 * widget surface.
 */
export class WidgetService implements IWidgetService {
    private static instance: WidgetService;
    private widgets: Map<string, IWidgetConfig> = new Map();
    private logger: ISystemLogService;
    private zoneRegistry: IZoneRegistry | null = null;
    private widgetTypeRegistry: IWidgetTypeRegistry | null = null;
    private placementService: IPlacementService | null = null;
    private placementResolver: PlacementResolver | null = null;

    private constructor(logger: ISystemLogService) {
        this.logger = logger;
    }

    /**
     * Get or create the singleton instance.
     */
    public static getInstance(logger?: ISystemLogService): WidgetService {
        if (!WidgetService.instance) {
            if (!logger) {
                throw new Error('Logger required for first WidgetService initialization');
            }
            WidgetService.instance = new WidgetService(logger);
        }
        return WidgetService.instance;
    }

    /**
     * Test-only reset to clear the singleton between unit tests.
     */
    public static __resetForTests(): void {
        // @ts-expect-error — clearing the private static for tests
        WidgetService.instance = undefined;
    }

    /**
     * Inject the process-wide zone registry. Called once during
     * bootstrap from the plugin loader.
     */
    public setZoneRegistry(registry: IZoneRegistry): void {
        this.zoneRegistry = registry;
    }

    /**
     * Inject the process-wide widget-type registry. Called once
     * during `WidgetsModule.init()`.
     */
    public setWidgetTypeRegistry(registry: IWidgetTypeRegistry): void {
        this.widgetTypeRegistry = registry;
    }

    /**
     * Inject the module-owned placement service. Called once during
     * `WidgetsModule.init()`.
     */
    public setPlacementService(service: IPlacementService): void {
        this.placementService = service;
    }

    /**
     * Inject the module-owned placement resolver. Called once during
     * `WidgetsModule.init()`. When set, `fetchWidgetsForRoute` routes
     * through the resolver instead of the in-memory cache.
     */
    public setPlacementResolver(resolver: PlacementResolver): void {
        this.placementResolver = resolver;
    }

    /**
     * Test whether a zone id is currently known.
     */
    private isKnownZone(zone: string): boolean {
        if (this.zoneRegistry) {
            return this.zoneRegistry.has(zone);
        }
        return FALLBACK_VALID_ZONES.has(zone);
    }

    /**
     * Register a widget with the service.
     *
     * In wired mode this splits into a widget-type declaration and a
     * plugin-source placement upsert. In unwired mode it falls back
     * to the legacy in-memory Map. Either way, the in-memory Map is
     * updated for sync admin reads.
     */
    public async register(config: IWidgetConfig, pluginId: string): Promise<void> {
        if (!this.isKnownZone(config.zone)) {
            this.logger.warn('Widget registered with unknown zone', {
                widgetId: config.id,
                pluginId,
                zone: config.zone
            });
        }

        // Maintain the legacy in-memory cache for sync admin reads
        // (`getAllWidgets`, `getWidgetsByZone`). PR 3 will replace
        // those endpoints with placement-backed lookups and remove
        // this cache.
        const widgetConfig: IWidgetConfig = {
            ...config,
            pluginId,
            order: config.order ?? DEFAULT_ORDER
        };
        this.widgets.set(config.id, widgetConfig);

        // If the new system isn't wired (tests), the in-memory cache
        // is the entire behaviour — keep going.
        if (!this.widgetTypeRegistry || !this.placementService) {
            this.logger.debug(
                { widgetId: config.id, pluginId },
                'Widget registered (legacy in-memory mode — placement service not wired)'
            );
            return;
        }

        // Resolve current ownership of the widget-type id before
        // routing into the registry. Three cases:
        //
        // - owner === pluginId: same plugin re-registering (hot
        //   reload during the same lifecycle window). Skip the
        //   registry call because `defineWidgetType` would throw on
        //   the cached id; the existing descriptor stays in place.
        // - owner === undefined: id is unclaimed. Mint a descriptor
        //   and register it.
        // - owner is some other plugin: cross-plugin id collision.
        //   Refuse to register the type AND refuse to create the
        //   placement, otherwise the new plugin's placement would
        //   silently render the first plugin's `defaultDataFetcher`.
        const currentOwner = this.widgetTypeRegistry.getOwnerPluginId(config.id);
        if (currentOwner !== undefined && currentOwner !== pluginId) {
            this.logger.error(
                {
                    widgetId: config.id,
                    pluginId,
                    existingOwner: currentOwner
                },
                'Refusing widget registration: type id is already owned by another plugin'
            );
            return;
        }

        if (currentOwner === pluginId) {
            // Same-plugin re-registration within an open lifecycle
            // window. The legacy service silently replaced the
            // in-memory config; the new system keeps the original
            // descriptor (and its data fetcher) intact. Flag this as
            // a likely plugin bug — re-enable through the admin UI
            // is the supported path for applying changed data
            // fetchers.
            this.logger.warn(
                { widgetId: config.id, pluginId },
                'Widget re-registered within the same lifecycle window; the original widget-type descriptor is preserved. Re-enable the plugin to apply a changed data fetcher.'
            );
        }

        if (currentOwner === undefined) {
            try {
                const descriptor = defineWidgetType({
                    id: config.id,
                    label: config.title ?? config.id,
                    description: config.description ?? '',
                    defaultDataFetcher: config.fetchData
                });
                this.widgetTypeRegistry.register(pluginId, descriptor);
            } catch (err) {
                this.logger.error(
                    {
                        err,
                        widgetId: config.id,
                        pluginId
                    },
                    'Failed to register widget type via compat shim'
                );
                return;
            }
        }

        // Ensure the plugin-source placement exists and is enabled.
        // Upsert semantics preserve operator customisations to
        // `order`, `routes`, `title` across plugin disable/re-enable.
        try {
            await this.placementService.ensurePluginPlacement({
                typeId: config.id,
                zoneId: config.zone,
                routes: config.routes,
                order: config.order,
                title: config.title,
                pluginId
            });
        } catch (err) {
            this.logger.error(
                {
                    err,
                    widgetId: config.id,
                    pluginId
                },
                'Failed to ensure plugin placement via compat shim'
            );
        }

        this.logger.debug(
            {
                widgetId: config.id,
                pluginId,
                zone: config.zone,
                routes: config.routes
            },
            'Widget registered via compat shim'
        );
    }

    /**
     * Unregister a widget by id.
     *
     * Legacy semantic — used by tests; production plugin lifecycle
     * uses `unregisterAll`. Clears the in-memory cache only; widget
     * types are disposed via `PluginManagerService.disposeWidgetTypes`
     * and placements are soft-disabled via
     * `PlacementService.softDisableForPlugin`.
     */
    public async unregister(widgetId: string): Promise<void> {
        const deleted = this.widgets.delete(widgetId);
        if (deleted) {
            this.logger.debug('Widget unregistered', { widgetId });
        } else {
            this.logger.warn('Attempted to unregister non-existent widget', { widgetId });
        }
    }

    /**
     * Unregister all widgets for a plugin.
     *
     * Closes the previous (PR 1) leak by chaining into the placement
     * service's soft-disable path. Widget-type disposal goes through
     * the dedicated plugin-manager lifecycle (see
     * `PluginManagerService.disposeWidgetTypes`).
     */
    public async unregisterAll(pluginId: string): Promise<void> {
        const widgetsToRemove: string[] = [];

        for (const [widgetId, config] of this.widgets.entries()) {
            if (config.pluginId === pluginId) {
                widgetsToRemove.push(widgetId);
            }
        }

        for (const widgetId of widgetsToRemove) {
            this.widgets.delete(widgetId);
        }

        this.logger.info('Legacy in-memory cache cleared for plugin', {
            pluginId,
            count: widgetsToRemove.length
        });

        if (this.placementService) {
            try {
                await this.placementService.softDisableForPlugin(pluginId);
            } catch (err) {
                this.logger.error(
                    { err, pluginId },
                    'Failed to soft-disable plugin placements via compat shim'
                );
            }
        }
    }

    /**
     * Fetch widget data for a route.
     *
     * Routes through the placement resolver when wired; falls back to
     * the legacy in-memory implementation for unwired test paths.
     */
    public async fetchWidgetsForRoute(
        route: string,
        params: Record<string, string> = {}
    ): Promise<IWidgetData[]> {
        if (this.placementResolver) {
            return this.placementResolver.resolveForRoute(route, params);
        }

        return this.legacyFetchWidgetsForRoute(route, params);
    }

    /**
     * Legacy in-memory fetch retained as a fallback for tests that
     * instantiate `WidgetService` without constructing `WidgetsModule`.
     * Production paths always run through the placement resolver.
     */
    private async legacyFetchWidgetsForRoute(
        route: string,
        params: Record<string, string>
    ): Promise<IWidgetData[]> {
        const matchingWidgets = Array.from(this.widgets.values()).filter(widget => {
            if (widget.routes.length === 0) {
                return true;
            }
            return widget.routes.includes(route);
        });

        if (matchingWidgets.length === 0) {
            return [];
        }

        this.logger.debug('Fetching widget data for route (legacy path)', {
            route,
            params,
            widgetCount: matchingWidgets.length
        });

        const TIMEOUT_MS = 5000;

        const widgetDataPromises = matchingWidgets.map(async (widget): Promise<IWidgetData | null> => {
            let timerId: NodeJS.Timeout | undefined;
            try {
                const timeoutPromise = new Promise<never>((_, reject) => {
                    timerId = setTimeout(() => reject(new Error('Widget fetch timeout')), TIMEOUT_MS);
                });
                const rawData = await Promise.race([
                    widget.fetchData(route, params),
                    timeoutPromise
                ]);
                clearTimeout(timerId);

                const data = this.validateSerializable(rawData, widget.id);
                if (data === null) {
                    return null;
                }

                return {
                    id: widget.id,
                    zone: widget.zone,
                    pluginId: widget.pluginId!,
                    order: widget.order ?? DEFAULT_ORDER,
                    title: widget.title,
                    data
                };
            } catch (error) {
                clearTimeout(timerId);
                this.logger.error('Widget data fetch failed', {
                    widgetId: widget.id,
                    pluginId: widget.pluginId,
                    error: error instanceof Error ? error.message : String(error)
                });
                return null;
            }
        });

        const widgetDataResults = await Promise.all(widgetDataPromises);

        const widgetData = widgetDataResults
            .filter((w): w is IWidgetData => w !== null)
            .sort((a, b) => {
                if (a.zone !== b.zone) {
                    return a.zone.localeCompare(b.zone);
                }
                return a.order - b.order;
            });

        this.logger.debug('Widget data fetched successfully (legacy path)', {
            route,
            successCount: widgetData.length,
            failedCount: matchingWidgets.length - widgetData.length
        });

        return widgetData;
    }

    private validateSerializable(data: unknown, widgetId: string): unknown {
        try {
            return JSON.parse(JSON.stringify(data));
        } catch (error) {
            this.logger.error('Widget returned non-serializable data', {
                widgetId,
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }

    /**
     * Get all registered widgets (sync legacy read).
     *
     * Returns the in-memory cache — plugin-source widgets only.
     * Operator-source placements (introduced via the admin API in
     * PR 3) are not visible through this method.
     */
    public getAllWidgets(): IWidgetConfig[] {
        return Array.from(this.widgets.values());
    }

    /**
     * Get widgets for a specific zone (sync legacy read).
     */
    public getWidgetsByZone(zone: string): IWidgetConfig[] {
        return Array.from(this.widgets.values())
            .filter(widget => widget.zone === zone)
            .sort((a, b) => (a.order ?? DEFAULT_ORDER) - (b.order ?? DEFAULT_ORDER));
    }
}
