/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for placement persistence and SSR
 * resolution.
 *
 * Exercises `PlacementService` against the shared in-memory
 * Mongo mock, `PlacementResolver` against stubbed registry +
 * service implementations, and the pure `routeMatches` predicate.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
    ISystemLogService,
    IWidgetPlacement,
    IWidgetType,
    IWidgetTypeRegistry,
    IPlacementService
} from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { PlacementService, type PlacementBroadcastCallback } from '../placements/placement.service.js';
import { PlacementResolver } from '../placements/placement-resolver.js';
import {
    routeMatches,
    normaliseRoutePattern,
    partitionRoutePatterns
} from '../placements/route-matcher.js';

class MockLogger implements ISystemLogService {
    public level = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_b: Record<string, unknown>): ISystemLogService => this);
    public async initialize() {}
    public async saveLog() {}
    public async getLogs() {
        return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false };
    }
    public async markAsResolved() {}
    public async cleanup() { return 0; }
    public async getStatistics() { return { total: 0, byLevel: {} as any, byService: {}, unresolved: 0 }; }
    public async getLogById() { return null; }
    public async markAsUnresolved() { return null; }
    public async deleteAllLogs() { return 0; }
    public async getStats() { return { total: 0, byLevel: {} as any, resolved: 0, unresolved: 0 }; }
    public async waitUntilInitialized() {}
}

describe('routeMatches', () => {
    it('matches every route when the filter is empty', () => {
        expect(routeMatches([], '/')).toBe(true);
        expect(routeMatches([], '/anything')).toBe(true);
    });

    it('matches exact strings only when the filter is populated', () => {
        expect(routeMatches(['/', '/markets'], '/')).toBe(true);
        expect(routeMatches(['/', '/markets'], '/markets')).toBe(true);
        expect(routeMatches(['/'], '/markets')).toBe(false);
        expect(routeMatches(['/'], '/tools/energy-estimator')).toBe(false);
    });

    it('handles single-segment globs', () => {
        expect(routeMatches(['/tools/*'], '/tools/energy-estimator')).toBe(true);
        expect(routeMatches(['/tools/*'], '/tools/')).toBe(false);
        expect(routeMatches(['/tools/*'], '/tools')).toBe(false);
        expect(routeMatches(['/tools/*'], '/tools/energy-estimator/faq')).toBe(false);
        expect(routeMatches(['/tools/*'], '/toolset/energy-estimator')).toBe(false);
    });

    it('handles deep globs', () => {
        expect(routeMatches(['/system/**'], '/system/logs')).toBe(true);
        expect(routeMatches(['/system/**'], '/system/logs/archive')).toBe(true);
        expect(routeMatches(['/system/**'], '/system/logs/archive/2024')).toBe(true);
        expect(routeMatches(['/system/**'], '/system')).toBe(false);
        expect(routeMatches(['/system/**'], '/systemx/logs')).toBe(false);
    });

    it('a deep glob at the root matches any path', () => {
        expect(routeMatches(['/**'], '/')).toBe(true);
        expect(routeMatches(['/**'], '/markets')).toBe(true);
        expect(routeMatches(['/**'], '/a/b/c')).toBe(true);
    });

    it('mixes patterns in a single filter', () => {
        const filter = ['/', '/markets', '/tools/*'];
        expect(routeMatches(filter, '/')).toBe(true);
        expect(routeMatches(filter, '/markets')).toBe(true);
        expect(routeMatches(filter, '/tools/energy-estimator')).toBe(true);
        expect(routeMatches(filter, '/tools/energy-estimator/faq')).toBe(false);
        expect(routeMatches(filter, '/admin')).toBe(false);
    });
});

describe('normaliseRoutePattern', () => {
    it('accepts exact paths', () => {
        expect(normaliseRoutePattern('/')).toBe('/');
        expect(normaliseRoutePattern('/markets')).toBe('/markets');
    });

    it('accepts trailing single and deep globs', () => {
        expect(normaliseRoutePattern('/tools/*')).toBe('/tools/*');
        expect(normaliseRoutePattern('/system/**')).toBe('/system/**');
    });

    it('trims whitespace surrounding a pattern', () => {
        expect(normaliseRoutePattern('  /markets  ')).toBe('/markets');
    });

    it('rejects empty and whitespace-only input', () => {
        expect(normaliseRoutePattern('')).toBeNull();
        expect(normaliseRoutePattern('   ')).toBeNull();
    });

    it('rejects patterns without a leading slash', () => {
        expect(normaliseRoutePattern('markets')).toBeNull();
        expect(normaliseRoutePattern('tools/*')).toBeNull();
    });

    it('rejects internal whitespace', () => {
        expect(normaliseRoutePattern('/with space')).toBeNull();
    });

    it('rejects glob markers anywhere except the trailing segment', () => {
        expect(normaliseRoutePattern('/*/markets')).toBeNull();
        expect(normaliseRoutePattern('/tools/*/extra')).toBeNull();
        expect(normaliseRoutePattern('/tools*')).toBeNull();
    });
});

describe('partitionRoutePatterns', () => {
    it('separates exact entries from glob entries', () => {
        const { exact, patterns } = partitionRoutePatterns([
            '/',
            '/markets',
            '/tools/*',
            '/system/**'
        ]);
        expect(exact).toEqual(['/', '/markets']);
        expect(patterns).toEqual(['/tools/*', '/system/**']);
    });

    it('returns empty buckets for an empty input', () => {
        const { exact, patterns } = partitionRoutePatterns([]);
        expect(exact).toEqual([]);
        expect(patterns).toEqual([]);
    });
});

describe('PlacementService.ensurePluginPlacement', () => {
    let logger: MockLogger;
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: PlacementService;

    beforeEach(() => {
        logger = new MockLogger();
        db = createMockDatabaseService();
        PlacementService.__resetForTests();
        PlacementService.setDependencies(db, logger);
        service = PlacementService.getInstance();
    });

    it('creates a new placement when none exists', async () => {
        const placement = await service.ensurePluginPlacement({
            typeId: 'whale-alerts:recent',
            zoneId: 'main-after',
            routes: ['/'],
            order: 20,
            title: 'Recent Whales',
            pluginId: 'whale-alerts'
        });

        expect(placement.typeId).toBe('whale-alerts:recent');
        expect(placement.zoneId).toBe('main-after');
        expect(placement.routes).toEqual(['/']);
        expect(placement.order).toBe(20);
        expect(placement.title).toBe('Recent Whales');
        expect(placement.pluginId).toBe('whale-alerts');
        expect(placement.source).toBe('plugin');
        expect(placement.enabled).toBe(true);
    });

    it('defaults order to 100 when not provided', async () => {
        const placement = await service.ensurePluginPlacement({
            typeId: 'p:t',
            zoneId: 'main-after',
            routes: [],
            pluginId: 'p'
        });

        expect(placement.order).toBe(100);
    });

    it('preserves operator customisations on re-enable', async () => {
        const first = await service.ensurePluginPlacement({
            typeId: 'p:t',
            zoneId: 'main-after',
            routes: ['/'],
            order: 50,
            title: 'Original',
            pluginId: 'p'
        });

        // Simulate operator customisation
        await service.update(first.id, { order: 5, routes: ['/dashboard'], title: 'Operator Override' });
        await service.softDisableForPlugin('p');

        // Re-enable — plugin code calls ensurePluginPlacement with its
        // original defaults again.
        const reenabled = await service.ensurePluginPlacement({
            typeId: 'p:t',
            zoneId: 'main-after',
            routes: ['/'],
            order: 50,
            title: 'Original',
            pluginId: 'p'
        });

        expect(reenabled.enabled).toBe(true);
        expect(reenabled.order).toBe(5);
        expect(reenabled.routes).toEqual(['/dashboard']);
        expect(reenabled.title).toBe('Operator Override');
    });

    it('rejects calls without a pluginId', async () => {
        await expect(
            service.ensurePluginPlacement({
                typeId: 'p:t',
                zoneId: 'main-after',
                routes: [],
                pluginId: ''
            })
        ).rejects.toThrow(/requires a pluginId/);
    });
});

describe('PlacementService.softDisableForPlugin', () => {
    let logger: MockLogger;
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: PlacementService;

    beforeEach(() => {
        logger = new MockLogger();
        db = createMockDatabaseService();
        PlacementService.__resetForTests();
        PlacementService.setDependencies(db, logger);
        service = PlacementService.getInstance();
    });

    it('flips enabled=false on every plugin-source row for the plugin', async () => {
        await service.ensurePluginPlacement({ typeId: 'a:t', zoneId: 'main-after', routes: [], pluginId: 'a' });
        await service.ensurePluginPlacement({ typeId: 'a:u', zoneId: 'main-after', routes: [], pluginId: 'a' });
        await service.ensurePluginPlacement({ typeId: 'b:t', zoneId: 'main-after', routes: [], pluginId: 'b' });

        const modified = await service.softDisableForPlugin('a');

        expect(modified).toBe(2);
        const aPlacements = await service.list({ pluginId: 'a' });
        expect(aPlacements.every(p => p.enabled === false)).toBe(true);
        const bPlacements = await service.list({ pluginId: 'b' });
        expect(bPlacements.every(p => p.enabled === true)).toBe(true);
    });

    it('does not touch operator-source rows', async () => {
        await service.ensurePluginPlacement({ typeId: 'a:t', zoneId: 'main-after', routes: [], pluginId: 'a' });
        const op = await service.create(
            { typeId: 'a:t', zoneId: 'main-after', routes: [] },
            { source: 'operator' }
        );

        await service.softDisableForPlugin('a');

        const operatorAfter = await service.findById(op.id);
        expect(operatorAfter?.enabled).toBe(true);
    });

    it('returns zero when the plugin owns nothing', async () => {
        const modified = await service.softDisableForPlugin('phantom');
        expect(modified).toBe(0);
    });
});

describe('PlacementService.findByRoute', () => {
    let logger: MockLogger;
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: PlacementService;

    beforeEach(() => {
        logger = new MockLogger();
        db = createMockDatabaseService();
        PlacementService.__resetForTests();
        PlacementService.setDependencies(db, logger);
        service = PlacementService.getInstance();
    });

    it('returns only enabled placements matching the route', async () => {
        await service.ensurePluginPlacement({ typeId: 'a:home', zoneId: 'main-after', routes: ['/'], pluginId: 'a' });
        await service.ensurePluginPlacement({ typeId: 'a:markets', zoneId: 'main-after', routes: ['/markets'], pluginId: 'a' });
        await service.ensurePluginPlacement({ typeId: 'a:all', zoneId: 'main-after', routes: [], pluginId: 'a' });

        // Disable one and ensure it doesn't surface
        const markets = await service.list({ pluginId: 'a' });
        const marketsRow = markets.find(p => p.typeId === 'a:markets')!;
        await service.update(marketsRow.id, { enabled: false });

        const homeResults = await service.findByRoute('/');
        const homeIds = homeResults.map(p => p.typeId);
        expect(homeIds).toContain('a:home');
        expect(homeIds).toContain('a:all');
        expect(homeIds).not.toContain('a:markets');
    });
});

describe('PlacementService CRUD', () => {
    let logger: MockLogger;
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: PlacementService;

    beforeEach(() => {
        logger = new MockLogger();
        db = createMockDatabaseService();
        PlacementService.__resetForTests();
        PlacementService.setDependencies(db, logger);
        service = PlacementService.getInstance();
    });

    it('create defaults source=operator and enabled=true', async () => {
        const placement = await service.create({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/']
        });

        expect(placement.source).toBe('operator');
        expect(placement.enabled).toBe(true);
        expect(placement.pluginId).toBeUndefined();
    });

    it('create rejects plugin-source without pluginId', async () => {
        await expect(
            service.create(
                { typeId: 't', zoneId: 'main-after', routes: [] },
                { source: 'plugin' }
            )
        ).rejects.toThrow(/requires options\.pluginId/);
    });

    it('update accepts title: null as an explicit unset signal', async () => {
        const placement = await service.create({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/'],
            title: 'Operator Title'
        });
        expect(placement.title).toBe('Operator Title');

        const cleared = await service.update(placement.id, { title: null });
        expect(cleared?.title).toBeUndefined();
    });

    it('persists titleUrl on create and clears it with titleUrl: null', async () => {
        const placement = await service.create({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/'],
            title: 'Operator Title',
            titleUrl: '/markets'
        });
        expect(placement.titleUrl).toBe('/markets');

        const updated = await service.update(placement.id, { titleUrl: '/profile' });
        expect(updated?.titleUrl).toBe('/profile');

        const cleared = await service.update(placement.id, { titleUrl: null });
        expect(cleared?.titleUrl).toBeUndefined();
        // Clearing the link leaves the title intact.
        expect(cleared?.title).toBe('Operator Title');
    });

    it('persists titleSize on create and reverts it to the default with titleSize: null', async () => {
        const placement = await service.create({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/'],
            title: 'Operator Title',
            titleSize: 'heading-lg'
        });
        expect(placement.titleSize).toBe('heading-lg');

        const updated = await service.update(placement.id, { titleSize: 'heading-xs' });
        expect(updated?.titleSize).toBe('heading-xs');

        const cleared = await service.update(placement.id, { titleSize: null });
        // Cleared back to the default (absent → renders heading-md); title intact.
        expect(cleared?.titleSize).toBeUndefined();
        expect(cleared?.title).toBe('Operator Title');
    });

    it('persists layoutWeight on create and clears it with layoutWeight: null', async () => {
        const placement = await service.create({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/'],
            layoutWeight: 2
        });
        expect(placement.layoutWeight).toBe(2);

        const updated = await service.update(placement.id, { layoutWeight: 3 });
        expect(updated?.layoutWeight).toBe(3);

        const cleared = await service.update(placement.id, { layoutWeight: null });
        expect(cleared?.layoutWeight).toBeUndefined();
    });

    it('update preserves untouched fields', async () => {
        const placement = await service.create({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/'],
            order: 50,
            title: 'Original'
        });
        const updated = await service.update(placement.id, { order: 5 });

        expect(updated?.order).toBe(5);
        expect(updated?.zoneId).toBe('main-after');
        expect(updated?.title).toBe('Original');
        expect(updated?.routes).toEqual(['/']);
    });

    it('update returns null for unknown ids', async () => {
        const result = await service.update('507f1f77bcf86cd799439011', { order: 5 });
        expect(result).toBeNull();
    });

    it('update returns null for malformed ids', async () => {
        const result = await service.update('not-an-objectid', { order: 5 });
        expect(result).toBeNull();
    });

    it('delete removes the row', async () => {
        const placement = await service.create({ typeId: 't', zoneId: 'main-after', routes: [] });
        const removed = await service.delete(placement.id);

        expect(removed).toBe(true);
        expect(await service.findById(placement.id)).toBeNull();
    });

    it('list applies filters', async () => {
        await service.create({ typeId: 'a', zoneId: 'main-after', routes: [] });
        await service.create({ typeId: 'b', zoneId: 'main-before', routes: [] });
        await service.create({ typeId: 'c', zoneId: 'main-after', routes: [], enabled: false });

        const filtered = await service.list({ zoneId: 'main-after' });
        expect(filtered.map(p => p.typeId).sort()).toEqual(['a', 'c']);

        const enabled = await service.list({ zoneId: 'main-after', enabledOnly: true });
        expect(enabled.map(p => p.typeId)).toEqual(['a']);
    });
});

describe('PlacementResolver', () => {
    let logger: MockLogger;
    let typeRegistry: IWidgetTypeRegistry;
    let placementService: IPlacementService;
    let resolver: PlacementResolver;

    const buildType = (id: string, fetcher: IWidgetType['defaultDataFetcher']): IWidgetType => ({
        id,
        label: id,
        description: '',
        defaultDataFetcher: fetcher
    });

    const buildPlacement = (overrides: Partial<IWidgetPlacement> = {}): IWidgetPlacement => ({
        id: overrides.id ?? 'placement-1',
        typeId: overrides.typeId ?? 'plugin:type',
        zoneId: overrides.zoneId ?? 'main-after',
        parentId: overrides.parentId,
        routes: overrides.routes ?? [],
        order: overrides.order ?? 10,
        title: overrides.title,
        instanceConfig: overrides.instanceConfig,
        enabled: overrides.enabled ?? true,
        source: overrides.source ?? 'plugin',
        pluginId: overrides.pluginId ?? 'plugin',
        createdAt: overrides.createdAt ?? new Date().toISOString(),
        updatedAt: overrides.updatedAt ?? new Date().toISOString()
    });

    beforeEach(() => {
        logger = new MockLogger();
        const types = new Map<string, IWidgetType>();
        typeRegistry = {
            register: vi.fn(),
            disposeForPlugin: vi.fn(() => 0),
            has: vi.fn((id: string) => types.has(id)),
            get: vi.fn((id: string) => types.get(id)),
            getOwnerPluginId: vi.fn((_id: string) => undefined),
            snapshot: vi.fn(() => ({ groups: [] }))
        };
        (typeRegistry as any).__types = types;
        placementService = {
            ensurePluginPlacement: vi.fn(),
            softDisableForPlugin: vi.fn(),
            findByRoute: vi.fn(async () => []),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            findById: vi.fn(),
            list: vi.fn(),
            restoreToPluginDefaults: vi.fn(),
            detachChildrenOf: vi.fn(async () => 0)
        };
        resolver = new PlacementResolver(placementService, typeRegistry, logger);
    });

    it('joins each placement to its type and runs the data fetcher', async () => {
        (typeRegistry as any).__types.set('plugin:type', buildType('plugin:type', async () => ({ items: [1, 2] })));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ id: 'p-1', typeId: 'plugin:type', zoneId: 'main-after', order: 10 })
        ]);

        const result = await resolver.resolveForRoute('/', {});

        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('plugin:type');
        expect(result[0].zone).toBe('main-after');
        expect(result[0].order).toBe(10);
        expect(result[0].data).toEqual({ items: [1, 2] });
    });

    it('skips placements whose type is not registered', async () => {
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ typeId: 'orphan:type' })
        ]);

        const result = await resolver.resolveForRoute('/', {});
        expect(result).toEqual([]);
    });

    it('drops a placement whose fetcher times out', async () => {
        (typeRegistry as any).__types.set(
            'slow:type',
            buildType('slow:type', () => new Promise(() => { /* never resolves */ }))
        );
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ typeId: 'slow:type' })
        ]);

        vi.useFakeTimers();
        const pending = resolver.resolveForRoute('/', {});
        await vi.advanceTimersByTimeAsync(5100);
        const result = await pending;
        vi.useRealTimers();

        expect(result).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                typeId: 'slow:type',
                error: 'Widget fetch timeout'
            }),
            'Widget data fetch failed'
        );
    });

    it('drops a placement whose fetcher returns non-serialisable data', async () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        (typeRegistry as any).__types.set('circular:type', buildType('circular:type', async () => circular));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ typeId: 'circular:type' })
        ]);

        const result = await resolver.resolveForRoute('/', {});

        expect(result).toEqual([]);
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ typeId: 'circular:type' }),
            'Widget returned non-serializable data'
        );
    });

    it('forwards { id, instanceConfig } to the data fetcher', async () => {
        const fetcher = vi.fn(async () => ({ ok: true }));
        (typeRegistry as any).__types.set('plugin:type', buildType('plugin:type', fetcher));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({
                id: 'p-cfg',
                typeId: 'plugin:type',
                instanceConfig: { maxPosts: 3, theme: 'compact' }
            })
        ]);

        await resolver.resolveForRoute('/markets', { foo: 'bar' });

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith(
            '/markets',
            { foo: 'bar' },
            { id: 'p-cfg', instanceConfig: { maxPosts: 3, theme: 'compact' } }
        );
    });

    it('substitutes an empty instanceConfig object when the placement carries none', async () => {
        const fetcher = vi.fn(async () => ({ ok: true }));
        (typeRegistry as any).__types.set('plugin:type', buildType('plugin:type', fetcher));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ id: 'p-empty', typeId: 'plugin:type', instanceConfig: undefined })
        ]);

        await resolver.resolveForRoute('/', {});

        expect(fetcher).toHaveBeenCalledWith(
            '/',
            {},
            { id: 'p-empty', instanceConfig: {} }
        );
    });

    it('forwards instanceConfig onto the returned IWidgetData', async () => {
        (typeRegistry as any).__types.set('plugin:type', buildType('plugin:type', async () => ({ ok: true })));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({
                id: 'p-cfg',
                typeId: 'plugin:type',
                instanceConfig: { maxPosts: 3, theme: 'compact' }
            })
        ]);

        const result = await resolver.resolveForRoute('/', {});

        expect(result).toHaveLength(1);
        expect(result[0].instanceConfig).toEqual({ maxPosts: 3, theme: 'compact' });
    });

    it('defaults the returned instanceConfig to {} when the placement carries none', async () => {
        (typeRegistry as any).__types.set('plugin:type', buildType('plugin:type', async () => ({ ok: true })));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ id: 'p-empty', typeId: 'plugin:type', instanceConfig: undefined })
        ]);

        const result = await resolver.resolveForRoute('/', {});

        expect(result).toHaveLength(1);
        expect(result[0].instanceConfig).toEqual({});
    });

    it('sorts results by zone (alphabetical), then order', async () => {
        // 'main-after' sorts before 'main-before' alphabetically, so
        // the expected ordering joins zone-asc then order-asc within
        // each zone.
        (typeRegistry as any).__types.set('t1', buildType('t1', async () => 'a'));
        (typeRegistry as any).__types.set('t2', buildType('t2', async () => 'b'));
        (typeRegistry as any).__types.set('t3', buildType('t3', async () => 'c'));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ id: 'p1', typeId: 't1', zoneId: 'main-before', order: 50 }),
            buildPlacement({ id: 'p2', typeId: 't2', zoneId: 'main-after', order: 5 }),
            buildPlacement({ id: 'p3', typeId: 't3', zoneId: 'main-after', order: 100 })
        ]);

        const result = await resolver.resolveForRoute('/', {});

        expect(result.map(r => r.id)).toEqual(['t2', 't3', 't1']);
        expect(result.map(r => r.zone)).toEqual(['main-after', 'main-after', 'main-before']);
        expect(result.map(r => r.order)).toEqual([5, 100, 50]);
    });

    it('nests children under their layout-group container, sorted by child order', async () => {
        (typeRegistry as any).__types.set('core:layout-group', buildType('core:layout-group', async () => ({ flexDirection: 'row' })));
        (typeRegistry as any).__types.set('child:type', buildType('child:type', async () => 'kid'));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ id: 'group-1', typeId: 'core:layout-group', source: 'operator', order: 10 }),
            buildPlacement({ id: 'child-b', typeId: 'child:type', source: 'operator', parentId: 'group-1', order: 20 }),
            buildPlacement({ id: 'child-a', typeId: 'child:type', source: 'operator', parentId: 'group-1', order: 5 })
        ]);

        const result = await resolver.resolveForRoute('/', {});

        // Only the container is top-level; its children are nested and
        // ordered by their own `order`, not their fetch order.
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('core:layout-group');
        expect(result[0].children?.map(c => c.order)).toEqual([5, 20]);
        expect(result[0].data).toEqual({ flexDirection: 'row' });
    });

    it('drops an orphan child whose container did not resolve', async () => {
        // The container's type is unregistered, so it is skipped; its
        // child must be dropped rather than promoted to top-level.
        (typeRegistry as any).__types.set('child:type', buildType('child:type', async () => 'kid'));
        (placementService.findByRoute as ReturnType<typeof vi.fn>).mockResolvedValue([
            buildPlacement({ id: 'group-gone', typeId: 'core:layout-group', source: 'operator' }),
            buildPlacement({ id: 'child-x', typeId: 'child:type', source: 'operator', parentId: 'group-gone' })
        ]);

        const result = await resolver.resolveForRoute('/', {});
        expect(result).toEqual([]);
    });
});

describe('PlacementService.findByRoute (globs)', () => {
    let logger: MockLogger;
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: PlacementService;

    beforeEach(() => {
        logger = new MockLogger();
        db = createMockDatabaseService();
        PlacementService.__resetForTests();
        PlacementService.setDependencies(db, logger);
        service = PlacementService.getInstance();
    });

    it('returns placements with single-glob patterns when the route matches one segment', async () => {
        await service.create({ typeId: 'tools:summary', zoneId: 'main-after', routes: ['/tools/*'] });
        await service.create({ typeId: 'home:hero', zoneId: 'main-after', routes: ['/'] });

        const results = await service.findByRoute('/tools/energy-estimator');
        const ids = results.map(p => p.typeId).sort();
        expect(ids).toEqual(['tools:summary']);
    });

    it('returns placements with deep-glob patterns at any depth', async () => {
        await service.create({ typeId: 'admin:nav', zoneId: 'main-after', routes: ['/admin/**'] });
        await service.create({ typeId: 'home:hero', zoneId: 'main-after', routes: ['/'] });

        const results = await service.findByRoute('/admin/users/edit');
        const ids = results.map(p => p.typeId).sort();
        expect(ids).toEqual(['admin:nav']);
    });

    it('excludes single-glob rows when the route has extra depth', async () => {
        await service.create({ typeId: 'tools:summary', zoneId: 'main-after', routes: ['/tools/*'] });

        const results = await service.findByRoute('/tools/energy-estimator/faq');
        expect(results).toEqual([]);
    });
});

describe('PlacementService broadcast wiring', () => {
    let logger: MockLogger;
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: PlacementService;
    let broadcast: ReturnType<typeof vi.fn<PlacementBroadcastCallback>>;

    beforeEach(() => {
        logger = new MockLogger();
        db = createMockDatabaseService();
        broadcast = vi.fn<PlacementBroadcastCallback>();
        PlacementService.__resetForTests();
        PlacementService.setDependencies(db, logger);
        service = PlacementService.getInstance();
        service.setBroadcast(broadcast);
    });

    it('fires placement:created on create', async () => {
        const placement = await service.create({ typeId: 't', zoneId: 'main-after', routes: [] });

        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith('placement:created', {
            id: placement.id,
            zoneId: 'main-after'
        });
    });

    it('fires placement:updated on update', async () => {
        const placement = await service.create({ typeId: 't', zoneId: 'main-after', routes: [] });
        broadcast.mockClear();

        await service.update(placement.id, { order: 50 });

        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith('placement:updated', {
            id: placement.id,
            zoneId: 'main-after'
        });
    });

    it('fires placement:deleted on delete', async () => {
        const placement = await service.create({ typeId: 't', zoneId: 'main-after', routes: [] });
        broadcast.mockClear();

        await service.delete(placement.id);

        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith('placement:deleted', { id: placement.id });
    });

    it('fires placement:restored on restoreToPluginDefaults', async () => {
        const placement = await service.ensurePluginPlacement({
            typeId: 't',
            zoneId: 'main-after',
            routes: [],
            order: 25,
            pluginId: 'p'
        });
        broadcast.mockClear();

        await service.restoreToPluginDefaults(placement.id, {
            zoneId: 'main-after',
            routes: ['/'],
            order: 25
        });

        expect(broadcast).toHaveBeenCalledTimes(1);
        expect(broadcast).toHaveBeenCalledWith('placement:restored', {
            id: placement.id,
            zoneId: 'main-after'
        });
    });

    it('does not fire on update of an unknown id', async () => {
        await service.update('507f1f77bcf86cd799439011', { order: 5 });
        expect(broadcast).not.toHaveBeenCalled();
    });

    it('does not fire on delete of an unknown id', async () => {
        await service.delete('507f1f77bcf86cd799439011');
        expect(broadcast).not.toHaveBeenCalled();
    });

    it('swallows broadcast errors so the mutation still succeeds', async () => {
        broadcast.mockImplementation(() => { throw new Error('boom'); });
        const placement = await service.create({ typeId: 't', zoneId: 'main-after', routes: [] });

        expect(placement.id).toBeTruthy();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ event: 'placement:created' }),
            expect.stringContaining('Placement broadcast callback threw')
        );
    });

    it('ignores broadcast after setBroadcast(null)', async () => {
        service.setBroadcast(null);
        await service.create({ typeId: 't', zoneId: 'main-after', routes: [] });
        expect(broadcast).not.toHaveBeenCalled();
    });
});

describe('PlacementService.restoreToPluginDefaults', () => {
    let logger: MockLogger;
    let db: ReturnType<typeof createMockDatabaseService>;
    let service: PlacementService;

    beforeEach(() => {
        logger = new MockLogger();
        db = createMockDatabaseService();
        PlacementService.__resetForTests();
        PlacementService.setDependencies(db, logger);
        service = PlacementService.getInstance();
    });

    it('restores zone, routes, order, title, and re-enables the row', async () => {
        const placement = await service.ensurePluginPlacement({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/'],
            order: 25,
            title: 'Default',
            pluginId: 'p'
        });

        // Operator customisation, then disable.
        await service.update(placement.id, {
            zoneId: 'main-before',
            routes: ['/dashboard'],
            order: 1,
            title: 'Operator Title',
            enabled: false
        });

        const restored = await service.restoreToPluginDefaults(placement.id, {
            zoneId: 'main-after',
            routes: ['/'],
            order: 25,
            title: 'Default'
        });

        expect(restored).not.toBeNull();
        expect(restored?.zoneId).toBe('main-after');
        expect(restored?.routes).toEqual(['/']);
        expect(restored?.order).toBe(25);
        expect(restored?.title).toBe('Default');
        expect(restored?.enabled).toBe(true);
    });

    it('unsets title when defaults have no title', async () => {
        const placement = await service.ensurePluginPlacement({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/'],
            title: 'Operator Title',
            pluginId: 'p'
        });

        const restored = await service.restoreToPluginDefaults(placement.id, {
            zoneId: 'main-after',
            routes: ['/'],
            order: 100
        });

        expect(restored?.title).toBeUndefined();
    });

    it('returns null for unknown ids', async () => {
        const result = await service.restoreToPluginDefaults('507f1f77bcf86cd799439011', {
            zoneId: 'main-after',
            routes: [],
            order: 100
        });
        expect(result).toBeNull();
    });

    it('returns null for malformed ids', async () => {
        const result = await service.restoreToPluginDefaults('not-an-objectid', {
            zoneId: 'main-after',
            routes: [],
            order: 100
        });
        expect(result).toBeNull();
    });
});
