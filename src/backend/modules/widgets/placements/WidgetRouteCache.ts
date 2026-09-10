/**
 * @fileoverview Short-lived cache for SSR widget resolution.
 *
 * Every page render asks the backend for the widgets on its route, and
 * resolving them runs a MongoDB placement query plus every placed widget's
 * data fetcher. The frontend asks twice per render, and one client can
 * request pages several times a second, so without a cache that work is
 * repeated for output that is the same for every visitor — no fetcher
 * receives the requesting user. This cache keeps each route's result for a
 * few seconds and lets concurrent requests for the same route share one
 * resolution.
 *
 * `WidgetsService` clears the cache on every write that changes what a
 * route resolves to, so operator edits appear immediately. The expiry only
 * bounds how stale live widget data (latest block, recent activity) can be
 * in server-rendered HTML; those widgets receive WebSocket updates after
 * hydration.
 *
 * @module backend/modules/widgets/placements/WidgetRouteCache
 */

import type { IWidgetData } from '@/types';

/**
 * How long a resolved route stays fresh. Short enough that live widget data
 * in server-rendered HTML is at most a few seconds old, long enough that a
 * burst of page requests resolves each route once.
 */
export const WIDGET_ROUTE_CACHE_TTL_MS = 5000;

/**
 * Upper bound on cached routes. Scanners request many distinct missing
 * paths, and each one is a separate key, so the map must not grow without
 * limit.
 */
export const WIDGET_ROUTE_CACHE_MAX_ENTRIES = 200;

/** A resolved route result plus the moment it was stored. */
interface ICachedRouteWidgets {
    widgets: IWidgetData[];
    storedAt: number;
}

/**
 * Per-route cache with expiry, request sharing, and explicit clearing.
 *
 * A utility, not a service: `WidgetsModule.init()` constructs one and
 * injects it into `WidgetsService`, which is its only user. It holds no
 * knowledge of placements — the caller supplies the resolve function —
 * so it can be tested without MongoDB.
 */
export class WidgetRouteCache {
    private readonly entries = new Map<string, ICachedRouteWidgets>();
    private readonly inFlight = new Map<string, Promise<IWidgetData[]>>();

    /**
     * Incremented by `clear()`. A resolution records the value it started
     * under and stores its result only if the value is unchanged, so a
     * resolution already running when an operator saves cannot write
     * pre-save data back into the cache after it was cleared.
     */
    private generation = 0;

    /**
     * @param ttlMs - How long a stored result is served before the route is
     *   resolved again; the module passes `WIDGET_ROUTE_CACHE_TTL_MS`.
     * @param maxEntries - Most routes held at once, so distinct paths from
     *   scanners cannot grow memory without limit.
     * @param now - Clock used to stamp and age entries; injectable so tests
     *   can advance time without waiting.
     */
    constructor(
        private readonly ttlMs: number = WIDGET_ROUTE_CACHE_TTL_MS,
        private readonly maxEntries: number = WIDGET_ROUTE_CACHE_MAX_ENTRIES,
        private readonly now: () => number = Date.now
    ) {}

    /**
     * Return the widgets for a route, resolving them only when no fresh
     * result is stored and no resolution is already running.
     *
     * Each caller receives its own copy, so a consumer that modifies the
     * result cannot change what later callers are served. A rejected
     * resolution is not stored; every caller waiting on it receives the
     * rejection and the next call tries again.
     *
     * @param route - Request path the widgets are resolved for; part of the
     *   cache key because placements are route-filtered.
     * @param params - Route params forwarded to data fetchers; part of the
     *   key because a fetcher may use them.
     * @param resolve - Performs the uncached resolution; called at most once
     *   per key while a resolution is running.
     * @returns The route's widget data, from the cache or freshly resolved.
     */
    async get(
        route: string,
        params: Record<string, string>,
        resolve: () => Promise<IWidgetData[]>
    ): Promise<IWidgetData[]> {
        const key = WidgetRouteCache.keyFor(route, params);
        const cached = this.entries.get(key);
        let widgets: IWidgetData[];

        if (cached && this.now() - cached.storedAt < this.ttlMs) {
            widgets = cached.widgets;
        } else {
            widgets = await (this.inFlight.get(key) ?? this.load(key, resolve));
        }

        return structuredClone(widgets);
    }

    /**
     * Drop every stored result and detach running resolutions.
     *
     * Called by `WidgetsService` after any write that changes what a route
     * resolves to. Callers already waiting on a running resolution still
     * receive it; the next caller starts a fresh one.
     */
    clear(): void {
        this.generation += 1;
        this.entries.clear();
        this.inFlight.clear();
    }

    /**
     * Start a resolution for a key and register it so concurrent callers
     * share it.
     *
     * @param key - Cache key the result is stored under.
     * @param resolve - Performs the uncached resolution.
     * @returns The pending resolution, shared by every caller for the key.
     */
    private load(key: string, resolve: () => Promise<IWidgetData[]>): Promise<IWidgetData[]> {
        const startedUnder = this.generation;
        const pending: Promise<IWidgetData[]> = resolve()
            .then(widgets => {
                if (startedUnder === this.generation) {
                    this.store(key, widgets);
                }
                return widgets;
            })
            .finally(() => {
                if (this.inFlight.get(key) === pending) {
                    this.inFlight.delete(key);
                }
            });
        this.inFlight.set(key, pending);
        return pending;
    }

    /**
     * Store a result, making room first when the cache is full.
     *
     * The key is removed before being re-added so the map's insertion
     * order stays oldest-first, which `evict()` relies on.
     *
     * @param key - Cache key to store under.
     * @param widgets - Resolved widget data to serve until it expires.
     */
    private store(key: string, widgets: IWidgetData[]): void {
        this.entries.delete(key);
        if (this.entries.size >= this.maxEntries) {
            this.evict();
        }
        this.entries.set(key, { widgets, storedAt: this.now() });
    }

    /**
     * Free space for a new entry: drop every expired entry, and if the
     * cache is still full, drop the oldest one.
     */
    private evict(): void {
        const expiredBefore = this.now() - this.ttlMs;
        for (const [key, entry] of this.entries) {
            if (entry.storedAt <= expiredBefore) {
                this.entries.delete(key);
            }
        }
        if (this.entries.size >= this.maxEntries) {
            const oldest = this.entries.keys().next();
            if (!oldest.done) {
                this.entries.delete(oldest.value);
            }
        }
    }

    /**
     * Build the cache key for a route and its params.
     *
     * Params are sorted by name so the same params in a different order map
     * to the same entry.
     *
     * @param route - Request path.
     * @param params - Route params.
     * @returns A string that is equal for equal route and params.
     */
    private static keyFor(route: string, params: Record<string, string>): string {
        const sortedParams = Object.keys(params)
            .sort()
            .map(name => [name, params[name]]);
        return JSON.stringify([route, sortedParams]);
    }
}
