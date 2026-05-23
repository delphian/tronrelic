/**
 * @fileoverview SSR placement resolver.
 *
 * Joins matching placement records with their widget-type
 * descriptors and runs each type's `defaultDataFetcher` in parallel
 * with a 5-second timeout and a JSON-serialisability check. Returns
 * the legacy `IWidgetData` shape so the existing frontend
 * `WidgetZone` component renders without changes.
 *
 * Replaces the legacy `WidgetService.fetchWidgetsForRoute` while
 * preserving its observable behaviour (parallel fetch, timeout per
 * widget, failed widgets dropped silently with an error log, sorted
 * by zone then order).
 *
 * @module backend/modules/widgets/placements/placement-resolver
 */

import type {
    IPlacementService,
    ISystemLogService,
    IWidgetData,
    IWidgetPlacement,
    IWidgetTypeRegistry
} from '@/types';

/**
 * Per-widget data-fetch timeout. Matches the legacy
 * `WidgetService.fetchWidgetsForRoute` behaviour so plugin authors
 * see no semantic change after the compat-shim migration.
 */
const TIMEOUT_MS = 5000;

/**
 * Pure resolver. No singleton — `WidgetsModule.init()` constructs one
 * with the bootstrap-owned widget-type registry plus the
 * module-owned placement service, and the compat-shim widget service
 * delegates to it.
 */
export class PlacementResolver {
    constructor(
        private readonly placementService: IPlacementService,
        private readonly widgetTypeRegistry: IWidgetTypeRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Resolve every widget that should render at the given route,
     * with their SSR data already fetched.
     *
     * Behaviour matches the legacy
     * `WidgetService.fetchWidgetsForRoute`: placements are joined to
     * widget types in-memory, fetched in parallel with a 5-second
     * timeout per fetch, JSON-serialisability is verified via a
     * round-trip, failed fetches are dropped with an error log, and
     * results are sorted by `(zoneId asc, order asc)`. Placements
     * whose `typeId` is not currently registered (e.g. plugin
     * disabled) are silently skipped.
     *
     * @param route - Request path resolved by the host.
     * @param params - Route params extracted by the host (e.g.
     *   `{ address }` on `/u/[address]`). Forwarded to each widget
     *   type's data fetcher.
     * @returns Widget data ready for the frontend, in render order.
     */
    async resolveForRoute(
        route: string,
        params: Record<string, string> = {}
    ): Promise<IWidgetData[]> {
        const placements = await this.placementService.findByRoute(route);
        if (placements.length === 0) return [];

        const results = await Promise.all(
            placements.map(p => this.fetchOne(p, route, params))
        );

        const filtered = results.filter((w): w is IWidgetData => w !== null);
        filtered.sort((a, b) => {
            if (a.zone !== b.zone) return a.zone.localeCompare(b.zone);
            return a.order - b.order;
        });

        this.logger.debug(
            {
                route,
                placementCount: placements.length,
                successCount: filtered.length,
                failedCount: placements.length - filtered.length
            },
            'Resolved widgets for route'
        );

        return filtered;
    }

    /**
     * Fetch a single placement's data with timeout + serialisability
     * guards. Returns `null` when the type is not registered, the
     * fetcher throws, the fetcher exceeds the timeout, or the
     * returned data is not JSON-serialisable.
     */
    private async fetchOne(
        placement: IWidgetPlacement,
        route: string,
        params: Record<string, string>
    ): Promise<IWidgetData | null> {
        const type = this.widgetTypeRegistry.get(placement.typeId);
        if (!type) {
            // Common case: plugin disabled or type unregistered.
            // Skip silently — the placement row will be re-joined
            // when the type re-registers on the next enable.
            return null;
        }

        let timerId: NodeJS.Timeout | undefined;
        try {
            const timeoutPromise = new Promise<never>((_, reject) => {
                timerId = setTimeout(() => reject(new Error('Widget fetch timeout')), TIMEOUT_MS);
            });
            const raw = await Promise.race([
                type.defaultDataFetcher(route, params),
                timeoutPromise
            ]);
            clearTimeout(timerId);

            const data = this.validateSerializable(raw, placement.typeId);
            if (data === null) return null;

            // Resolve owning plugin id from the registry — the
            // authoritative source — so operator placements (which
            // omit `placement.pluginId`) and non-namespaced type ids
            // both surface the correct frontend plugin context.
            // Falls back to placement.pluginId only when the type
            // isn't registered to anyone, which shouldn't happen
            // because the type was just fetched from the registry
            // above.
            const owner =
                this.widgetTypeRegistry.getOwnerPluginId(placement.typeId) ??
                placement.pluginId ??
                'unknown';

            return {
                id: placement.typeId,
                zone: placement.zoneId,
                pluginId: owner,
                order: placement.order,
                title: placement.title,
                data
            };
        } catch (error) {
            clearTimeout(timerId);
            this.logger.error(
                {
                    typeId: placement.typeId,
                    placementId: placement.id,
                    pluginId: placement.pluginId,
                    error: error instanceof Error ? error.message : String(error)
                },
                'Widget data fetch failed'
            );
            return null;
        }
    }

    /**
     * Verify the fetched data round-trips through `JSON.stringify` so
     * the SSR payload is safe to embed in the response. Returns
     * `null` on non-serialisable input (BigInt, circular refs,
     * functions). Pure transform — does not mutate `data`.
     */
    private validateSerializable(data: unknown, typeId: string): unknown {
        try {
            return JSON.parse(JSON.stringify(data));
        } catch (error) {
            this.logger.error(
                {
                    typeId,
                    error: error instanceof Error ? error.message : String(error)
                },
                'Widget returned non-serializable data'
            );
            return null;
        }
    }
}
