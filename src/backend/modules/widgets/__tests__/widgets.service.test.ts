/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the unified WidgetsService.
 *
 * Exercises the public IWidgetsService surface end-to-end with the
 * internal collaborators wired the way WidgetsModule.init() wires them
 * in production. Mongo backing is the shared in-memory mock so the
 * placement service's upsert/find semantics are exercised for real
 * rather than stubbed.
 *
 * @module backend/modules/widgets/__tests__/widgets.service.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { WidgetsService } from '../widgets.service.js';
import { ZoneRegistry } from '../zones/zone-registry.js';
import { WidgetTypeRegistry } from '../widget-types/widget-type-registry.js';
import { PlacementService } from '../placements/placement.service.js';
import { PlacementResolver } from '../placements/placement-resolver.js';
import { __resetKnownZonesForTests } from '../zones/define-zone.js';
import { __resetKnownWidgetTypesForTests } from '../widget-types/define-widget-type.js';

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

/**
 * Build a fully wired WidgetsService over fresh internal collaborators
 * and a fresh in-memory database. Mirrors the wiring WidgetsModule.init()
 * performs in production.
 */
function buildWidgetsService(): {
    widgets: WidgetsService;
    zones: ZoneRegistry;
    types: WidgetTypeRegistry;
    placements: PlacementService;
    logger: MockLogger;
} {
    const logger = new MockLogger();
    const db = createMockDatabaseService();
    PlacementService.__resetForTests();
    PlacementService.setDependencies(db, logger);
    const placements = PlacementService.getInstance();
    const zones = new ZoneRegistry(logger);
    const types = new WidgetTypeRegistry(logger);
    const resolver = new PlacementResolver(placements, types, logger);
    WidgetsService.__resetForTests();
    WidgetsService.setDependencies(zones, types, placements, resolver, logger);
    return { widgets: WidgetsService.getInstance(), zones, types, placements, logger };
}

beforeEach(() => {
    __resetKnownZonesForTests();
    __resetKnownWidgetTypesForTests();
});

describe('WidgetsService.registerZone', () => {
    it('registers a zone and surfaces it in the snapshot', () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({
            id: 'my-plugin:sidebar',
            label: 'Sidebar',
            description: 'Right rail',
            host: 'plugin',
            layout: 'vertical'
        }, 'my-plugin');

        expect(widgets.hasZone('my-plugin:sidebar')).toBe(true);
        const snapshot = widgets.listZones();
        const allZoneIds = snapshot.tracks.flatMap(t => t.zones.map(z => z.id));
        expect(allZoneIds).toContain('my-plugin:sidebar');
    });

    it('rejects empty ownerId', () => {
        const { widgets } = buildWidgetsService();
        expect(() => widgets.registerZone({
            id: 'x:y',
            label: 'X',
            description: 'X',
            host: 'plugin'
        }, '')).toThrow(/requires a non-empty string ownerId/);
    });
});

describe('WidgetsService.registerType', () => {
    it('registers a widget type and surfaces it in the snapshot', () => {
        const { widgets } = buildWidgetsService();
        widgets.registerType({
            id: 'my-plugin:feed',
            label: 'Feed',
            description: 'Feed widget',
            defaultDataFetcher: async () => ({})
        }, 'my-plugin');

        expect(widgets.hasType('my-plugin:feed')).toBe(true);
        const snapshot = widgets.listTypes();
        const allTypeIds = snapshot.groups.flatMap(g => g.types.map(t => t.id));
        expect(allTypeIds).toContain('my-plugin:feed');
    });

    it('same-owner re-registration is a no-op (existing descriptor preserved)', () => {
        const { widgets, logger } = buildWidgetsService();
        widgets.registerType({
            id: 'p:t',
            label: 'A',
            description: 'A',
            defaultDataFetcher: async () => ({ first: true })
        }, 'p');
        const secondDisposer = widgets.registerType({
            id: 'p:t',
            label: 'B',
            description: 'B',
            defaultDataFetcher: async () => ({ second: true })
        }, 'p');

        // No-op disposer should not throw on invocation.
        expect(() => secondDisposer()).not.toThrow();
        expect(logger.warn).toHaveBeenCalled();
    });

    it('cross-owner conflict throws', () => {
        const { widgets } = buildWidgetsService();
        widgets.registerType({
            id: 'shared:id',
            label: 'A',
            description: 'A',
            defaultDataFetcher: async () => ({})
        }, 'plugin-a');

        expect(() => widgets.registerType({
            id: 'shared:id',
            label: 'B',
            description: 'B',
            defaultDataFetcher: async () => ({})
        }, 'plugin-b')).toThrow(/is already owned by 'plugin-a'/);
    });
});

describe('WidgetsService.registerWidget', () => {
    it('caches plugin defaults, registers type, and upserts a plugin-source placement', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({
            id: 'main-after', label: 'Main after', description: 'm', host: 'core'
        }, 'core');

        await widgets.registerWidget({
            id: 'p:feed',
            label: 'Feed',
            description: 'Feed',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/'],
            defaultOrder: 25,
            defaultTitle: 'My Feed',
            defaultDataFetcher: async () => ({})
        }, 'p');

        expect(widgets.hasType('p:feed')).toBe(true);
        const list = await widgets.listPlacements({ pluginId: 'p' });
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({
            typeId: 'p:feed',
            zoneId: 'main-after',
            order: 25,
            title: 'My Feed',
            source: 'plugin',
            pluginId: 'p',
            enabled: true
        });
    });

    it('re-registration preserves operator overrides on existing placement', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');

        await widgets.registerWidget({
            id: 'p:feed',
            label: 'Feed',
            description: 'Feed',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/'],
            defaultOrder: 25,
            defaultDataFetcher: async () => ({})
        }, 'p');

        const [original] = await widgets.listPlacements({ pluginId: 'p' });
        await widgets.updatePlacement(original.id, { order: 5, routes: ['/operator-set'] });
        await widgets.unregisterAllForOwner('p');

        // Re-register with the same args
        await widgets.registerWidget({
            id: 'p:feed',
            label: 'Feed',
            description: 'Feed',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/'],
            defaultOrder: 25,
            defaultDataFetcher: async () => ({})
        }, 'p');

        const [restored] = await widgets.listPlacements({ pluginId: 'p' });
        expect(restored.enabled).toBe(true);
        expect(restored.order).toBe(5);
        expect(restored.routes).toEqual(['/operator-set']);
    });

    it("refuses ownerId 'core'", async () => {
        const { widgets } = buildWidgetsService();
        await expect(widgets.registerWidget({
            id: 'core:x',
            label: 'X',
            description: 'X',
            defaultZoneId: 'main-after',
            defaultRoutes: [],
            defaultDataFetcher: async () => ({})
        }, 'core')).rejects.toThrow(/core does not create plugin-source placements/);
    });

    it('warns when targeting an unknown zone but still upserts the placement', async () => {
        const { widgets, logger } = buildWidgetsService();
        await widgets.registerWidget({
            id: 'p:feed',
            label: 'Feed',
            description: 'Feed',
            defaultZoneId: 'unknown-zone',
            defaultRoutes: [],
            defaultDataFetcher: async () => ({})
        }, 'p');

        expect(logger.warn).toHaveBeenCalled();
        const list = await widgets.listPlacements({ pluginId: 'p' });
        expect(list).toHaveLength(1);
        expect(list[0].zoneId).toBe('unknown-zone');
    });

    it('refuses to upsert a placement for a typeId owned by a different plugin', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({
            id: 'main-after', label: 'm', description: 'm', host: 'core'
        }, 'core');

        await widgets.registerWidget({
            id: 'shared:feed',
            label: 'Feed A',
            description: 'A',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/'],
            defaultDataFetcher: async () => ({ owner: 'a' })
        }, 'plugin-a');

        await expect(widgets.registerWidget({
            id: 'shared:feed',
            label: 'Feed B',
            description: 'B',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/'],
            defaultDataFetcher: async () => ({ owner: 'b' })
        }, 'plugin-b')).rejects.toThrow(/already owned by plugin "plugin-a"/);

        // Plugin B must not have a placement and must not have poisoned the cache.
        const bPlacements = await widgets.listPlacements({ pluginId: 'plugin-b' });
        expect(bPlacements).toHaveLength(0);

        // Plugin A's placement and type are unchanged.
        const aPlacements = await widgets.listPlacements({ pluginId: 'plugin-a' });
        expect(aPlacements).toHaveLength(1);
        expect(aPlacements[0].typeId).toBe('shared:feed');
    });
});

describe('WidgetsService.unregisterAllForOwner', () => {
    it('soft-disables placements, disposes types, and disposes zones', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'core-zone', label: 'c', description: 'c', host: 'core' }, 'core');
        widgets.registerZone({ id: 'p:owned', label: 'p', description: 'p', host: 'plugin' }, 'p');
        await widgets.registerWidget({
            id: 'p:feed',
            label: 'F',
            description: 'F',
            defaultZoneId: 'core-zone',
            defaultRoutes: [],
            defaultDataFetcher: async () => ({})
        }, 'p');

        await widgets.unregisterAllForOwner('p');

        expect(widgets.hasZone('p:owned')).toBe(false);
        expect(widgets.hasType('p:feed')).toBe(false);
        const placements = await widgets.listPlacements({ pluginId: 'p' });
        expect(placements).toHaveLength(1);
        expect(placements[0].enabled).toBe(false);
        // Core zone untouched.
        expect(widgets.hasZone('core-zone')).toBe(true);
    });

    it("is a no-op for ownerId 'core'", async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'core-zone', label: 'c', description: 'c', host: 'core' }, 'core');
        await widgets.unregisterAllForOwner('core');
        expect(widgets.hasZone('core-zone')).toBe(true);
    });

    it('is a no-op for empty ownerId', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'core-zone', label: 'c', description: 'c', host: 'core' }, 'core');
        await widgets.unregisterAllForOwner('');
        expect(widgets.hasZone('core-zone')).toBe(true);
    });
});

describe('WidgetsService.restorePluginDefaults', () => {
    it('reverts operator overrides to cached plugin defaults', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');
        await widgets.registerWidget({
            id: 'p:feed',
            label: 'F',
            description: 'F',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/'],
            defaultOrder: 25,
            defaultTitle: 'Plugin Title',
            defaultDataFetcher: async () => ({})
        }, 'p');

        const [original] = await widgets.listPlacements({ pluginId: 'p' });
        await widgets.updatePlacement(original.id, {
            order: 5,
            routes: ['/operator'],
            title: 'Operator Title'
        });

        const restored = await widgets.restorePluginDefaults(original.id);

        expect(restored).not.toBeNull();
        expect(restored?.order).toBe(25);
        expect(restored?.routes).toEqual(['/']);
        expect(restored?.title).toBe('Plugin Title');
        expect(restored?.enabled).toBe(true);
    });

    it('returns null for an unknown placement id', async () => {
        const { widgets } = buildWidgetsService();
        const result = await widgets.restorePluginDefaults('507f1f77bcf86cd799439011');
        expect(result).toBeNull();
    });

    it('throws on operator-source placements', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');
        widgets.registerType({
            id: 't',
            label: 'T',
            description: 'T',
            defaultDataFetcher: async () => ({})
        }, 'p');
        const op = await widgets.createPlacement({
            typeId: 't',
            zoneId: 'main-after',
            routes: []
        });

        await expect(widgets.restorePluginDefaults(op.id)).rejects.toThrow(
            /only valid on plugin-source placements/
        );
    });

    it('throws when the plugin defaults cache misses', async () => {
        const { widgets, placements } = buildWidgetsService();
        // Bypass the cache-populating path: write a plugin-source row
        // directly through the placement service.
        const orphan = await placements.ensurePluginPlacement({
            typeId: 'orphan:t',
            zoneId: 'main-after',
            routes: [],
            pluginId: 'orphan-plugin'
        });

        await expect(widgets.restorePluginDefaults(orphan.id)).rejects.toThrow(
            /No cached plugin defaults/
        );
    });
});

describe('WidgetsService.createPlacement', () => {
    it('validates that the widget type exists', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');

        await expect(widgets.createPlacement({
            typeId: 'unknown:type',
            zoneId: 'main-after',
            routes: []
        })).rejects.toThrow(/Unknown widget type/);
    });

    it('validates that the zone exists', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerType({
            id: 't',
            label: 'T',
            description: 'T',
            defaultDataFetcher: async () => ({})
        }, 'p');

        await expect(widgets.createPlacement({
            typeId: 't',
            zoneId: 'unknown-zone',
            routes: []
        })).rejects.toThrow(/Unknown zone/);
    });

    it('creates an operator-source placement when both validations pass', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');
        widgets.registerType({
            id: 't',
            label: 'T',
            description: 'T',
            defaultDataFetcher: async () => ({})
        }, 'p');

        const placement = await widgets.createPlacement({
            typeId: 't',
            zoneId: 'main-after',
            routes: ['/markets']
        });

        expect(placement.source).toBe('operator');
        expect(placement.pluginId).toBeUndefined();
        expect(placement.enabled).toBe(true);
    });
});

describe('WidgetsService.updatePlacement', () => {
    it('rejects an unknown zoneId in the patch', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');
        widgets.registerType({
            id: 't', label: 'T', description: 'T', defaultDataFetcher: async () => ({})
        }, 'p');
        const placement = await widgets.createPlacement({
            typeId: 't', zoneId: 'main-after', routes: []
        });

        await expect(widgets.updatePlacement(placement.id, { zoneId: 'phantom' }))
            .rejects.toThrow(/Unknown zone/);
    });

    it('returns null for unknown placement ids', async () => {
        const { widgets } = buildWidgetsService();
        const result = await widgets.updatePlacement(
            '507f1f77bcf86cd799439011',
            { order: 10 }
        );
        expect(result).toBeNull();
    });
});

describe('WidgetsService.deletePlacement', () => {
    it('refuses plugin-source placements', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');
        await widgets.registerWidget({
            id: 'p:feed',
            label: 'F',
            description: 'F',
            defaultZoneId: 'main-after',
            defaultRoutes: [],
            defaultDataFetcher: async () => ({})
        }, 'p');

        const [plugin] = await widgets.listPlacements({ pluginId: 'p' });
        await expect(widgets.deletePlacement(plugin.id)).rejects.toThrow(
            /Plugin-source placements cannot be deleted/
        );
    });

    it('deletes operator-source placements', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');
        widgets.registerType({
            id: 't', label: 'T', description: 'T', defaultDataFetcher: async () => ({})
        }, 'p');
        const op = await widgets.createPlacement({
            typeId: 't', zoneId: 'main-after', routes: []
        });

        const removed = await widgets.deletePlacement(op.id);
        expect(removed).toBe(true);
        expect(await widgets.findPlacementById(op.id)).toBeNull();
    });

    it('returns false for unknown ids', async () => {
        const { widgets } = buildWidgetsService();
        const removed = await widgets.deletePlacement('507f1f77bcf86cd799439011');
        expect(removed).toBe(false);
    });
});

describe('WidgetsService.fetchWidgetsForRoute', () => {
    it('resolves placements through the SSR resolver, applying route filters', async () => {
        const { widgets } = buildWidgetsService();
        widgets.registerZone({ id: 'main-after', label: 'm', description: 'm', host: 'core' }, 'core');
        await widgets.registerWidget({
            id: 'p:home',
            label: 'Home',
            description: 'Home',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/'],
            defaultDataFetcher: async () => ({ kind: 'home' })
        }, 'p');
        await widgets.registerWidget({
            id: 'p:markets',
            label: 'Markets',
            description: 'Markets',
            defaultZoneId: 'main-after',
            defaultRoutes: ['/markets'],
            defaultDataFetcher: async () => ({ kind: 'markets' })
        }, 'p');

        const home = await widgets.fetchWidgetsForRoute('/');
        expect(home.map(w => w.id)).toEqual(['p:home']);

        const markets = await widgets.fetchWidgetsForRoute('/markets');
        expect(markets.map(w => w.id)).toEqual(['p:markets']);
    });
});
