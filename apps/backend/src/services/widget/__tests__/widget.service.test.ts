/// <reference types="vitest" />

/**
 * Unit tests for WidgetService.
 *
 * Tests widget registration, route matching, data fetching with timeout,
 * and error handling. Uses mock logger to verify logging behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ISystemLogService, IWidgetConfig } from '@tronrelic/types';
import { WidgetService } from '../widget.service.js';

/**
 * Mock logger implementation for testing.
 */
class MockLogger implements ISystemLogService {
    public level = 'info';
    public fatal = vi.fn();
    public error = vi.fn();
    public warn = vi.fn();
    public info = vi.fn();
    public debug = vi.fn();
    public trace = vi.fn();
    public child = vi.fn((_bindings: Record<string, unknown>): ISystemLogService => {
        return this;
    });

    public async initialize() {}
    public async saveLog() {}
    public async getLogs() { return { logs: [], total: 0, page: 1, limit: 50, totalPages: 0, hasNextPage: false, hasPrevPage: false }; }
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
 * Helper to create a minimal widget config for testing.
 */
function createWidget(overrides: Partial<IWidgetConfig> = {}): IWidgetConfig {
    return {
        id: 'test-widget',
        zone: 'main-after',
        routes: ['/'],
        fetchData: async (_route: string, _params: Record<string, string>) => ({ test: true }),
        ...overrides
    };
}

describe('WidgetService', () => {
    let service: WidgetService;
    let mockLogger: MockLogger;

    beforeEach(() => {
        vi.clearAllMocks();

        // Reset singleton for each test
        (WidgetService as any).instance = undefined;

        mockLogger = new MockLogger();
        service = WidgetService.getInstance(mockLogger);
    });

    describe('getInstance', () => {
        it('should return singleton instance', () => {
            const instance1 = WidgetService.getInstance(mockLogger);
            const instance2 = WidgetService.getInstance();

            expect(instance1).toBe(instance2);
        });

        it('should throw if first call has no logger', () => {
            (WidgetService as any).instance = undefined;

            expect(() => WidgetService.getInstance()).toThrow(
                'Logger required for first WidgetService initialization'
            );
        });
    });

    describe('register', () => {
        it('should register a widget', async () => {
            await service.register(createWidget({ id: 'my-widget' }), 'test-plugin');

            const widgets = service.getAllWidgets();
            expect(widgets).toHaveLength(1);
            expect(widgets[0].id).toBe('my-widget');
            expect(widgets[0].pluginId).toBe('test-plugin');
        });

        it('should set default order to 100', async () => {
            await service.register(createWidget({ order: undefined }), 'plugin');

            const widgets = service.getAllWidgets();
            expect(widgets[0].order).toBe(100);
        });

        it('should preserve explicit order', async () => {
            await service.register(createWidget({ order: 50 }), 'plugin');

            const widgets = service.getAllWidgets();
            expect(widgets[0].order).toBe(50);
        });

        it('should replace existing widget with same ID', async () => {
            await service.register(
                createWidget({ id: 'dup', title: 'First' }),
                'plugin'
            );
            await service.register(
                createWidget({ id: 'dup', title: 'Second' }),
                'plugin'
            );

            const widgets = service.getAllWidgets();
            expect(widgets).toHaveLength(1);
            expect(widgets[0].title).toBe('Second');
        });

        it('should warn on unknown zone', async () => {
            await service.register(
                createWidget({ zone: 'unknown-zone' as any }),
                'plugin'
            );

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Widget registered with unknown zone',
                expect.objectContaining({ zone: 'unknown-zone' })
            );
        });

        it('should not warn on valid zones', async () => {
            const validZones = [
                'main-before',
                'main-after',
                'plugin-content:before',
                'plugin-content:after',
                'sidebar-top',
                'sidebar-bottom'
            ];
            for (const zone of validZones) {
                await service.register(
                    createWidget({ id: `widget-${zone}`, zone: zone as any }),
                    'plugin'
                );
            }

            expect(mockLogger.warn).not.toHaveBeenCalled();
        });
    });

    describe('unregister', () => {
        it('should remove a widget', async () => {
            await service.register(createWidget({ id: 'to-remove' }), 'plugin');
            await service.unregister('to-remove');

            expect(service.getAllWidgets()).toHaveLength(0);
        });

        it('should warn when unregistering non-existent widget', async () => {
            await service.unregister('does-not-exist');

            expect(mockLogger.warn).toHaveBeenCalledWith(
                'Attempted to unregister non-existent widget',
                { widgetId: 'does-not-exist' }
            );
        });
    });

    describe('unregisterAll', () => {
        it('should remove all widgets for a plugin', async () => {
            await service.register(createWidget({ id: 'w1' }), 'plugin-a');
            await service.register(createWidget({ id: 'w2' }), 'plugin-a');
            await service.register(createWidget({ id: 'w3' }), 'plugin-b');

            await service.unregisterAll('plugin-a');

            const remaining = service.getAllWidgets();
            expect(remaining).toHaveLength(1);
            expect(remaining[0].pluginId).toBe('plugin-b');
        });

        it('should handle plugin with no widgets', async () => {
            await service.unregisterAll('no-widgets');

            expect(mockLogger.info).toHaveBeenCalledWith(
                'All widgets unregistered for plugin',
                { pluginId: 'no-widgets', count: 0 }
            );
        });
    });

    describe('fetchWidgetsForRoute', () => {
        it('should filter widgets by exact route match', async () => {
            await service.register(
                createWidget({ id: 'home', routes: ['/'], fetchData: async () => ({ page: 'home' }) }),
                'plugin'
            );
            await service.register(
                createWidget({ id: 'markets', routes: ['/markets'], fetchData: async () => ({ page: 'markets' }) }),
                'plugin'
            );

            const homeWidgets = await service.fetchWidgetsForRoute('/', {});
            expect(homeWidgets).toHaveLength(1);
            expect(homeWidgets[0].id).toBe('home');

            const marketWidgets = await service.fetchWidgetsForRoute('/markets', {});
            expect(marketWidgets).toHaveLength(1);
            expect(marketWidgets[0].id).toBe('markets');
        });

        it('should include widgets with empty routes on all pages', async () => {
            await service.register(
                createWidget({ id: 'global', routes: [], fetchData: async () => ({ global: true }) }),
                'plugin'
            );

            const homeWidgets = await service.fetchWidgetsForRoute('/', {});
            const marketWidgets = await service.fetchWidgetsForRoute('/markets', {});
            const randomWidgets = await service.fetchWidgetsForRoute('/random/page', {});

            expect(homeWidgets).toHaveLength(1);
            expect(marketWidgets).toHaveLength(1);
            expect(randomWidgets).toHaveLength(1);
        });

        it('should exclude widgets with failing fetchData', async () => {
            await service.register(
                createWidget({ id: 'good', fetchData: async () => ({ works: true }) }),
                'plugin'
            );
            await service.register(
                createWidget({ id: 'bad', fetchData: async () => { throw new Error('Failed'); } }),
                'plugin'
            );

            const widgets = await service.fetchWidgetsForRoute('/', {});

            expect(widgets).toHaveLength(1);
            expect(widgets[0].id).toBe('good');
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Widget data fetch failed',
                expect.objectContaining({ widgetId: 'bad' })
            );
        });

        it('should timeout slow widgets', async () => {
            await service.register(
                createWidget({
                    id: 'slow',
                    fetchData: async () => {
                        await new Promise(resolve => setTimeout(resolve, 10000));
                        return { slow: true };
                    }
                }),
                'plugin'
            );

            const start = Date.now();
            const widgets = await service.fetchWidgetsForRoute('/', {});
            const elapsed = Date.now() - start;

            expect(widgets).toHaveLength(0);
            expect(elapsed).toBeLessThan(6000);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Widget data fetch failed',
                expect.objectContaining({
                    widgetId: 'slow',
                    error: 'Widget fetch timeout'
                })
            );
        }, 10000);

        it('should sort widgets by zone then order', async () => {
            await service.register(
                createWidget({ id: 'b', zone: 'main-after', order: 20 }),
                'plugin'
            );
            await service.register(
                createWidget({ id: 'a', zone: 'main-after', order: 10 }),
                'plugin'
            );
            await service.register(
                createWidget({ id: 'c', zone: 'main-before', order: 5 }),
                'plugin'
            );

            const widgets = await service.fetchWidgetsForRoute('/', {});

            // main-after comes before main-before alphabetically ('a' < 'b')
            // Within main-after: order 10 (a) comes before order 20 (b)
            expect(widgets.map(w => w.id)).toEqual(['a', 'b', 'c']);
        });

        it('should return empty array for routes with no widgets', async () => {
            await service.register(
                createWidget({ routes: ['/specific'] }),
                'plugin'
            );

            const widgets = await service.fetchWidgetsForRoute('/other', {});
            expect(widgets).toEqual([]);
        });

        it('should handle non-serializable data gracefully', async () => {
            const circular: any = { a: 1 };
            circular.self = circular;

            await service.register(
                createWidget({
                    id: 'circular',
                    fetchData: async () => circular
                }),
                'plugin'
            );

            const widgets = await service.fetchWidgetsForRoute('/', {});

            expect(widgets).toHaveLength(0);
            expect(mockLogger.error).toHaveBeenCalledWith(
                'Widget returned non-serializable data',
                expect.objectContaining({ widgetId: 'circular' })
            );
        });

        it('should include widget data in response', async () => {
            const testData = { items: [1, 2, 3], count: 3 };
            await service.register(
                createWidget({
                    id: 'data-widget',
                    title: 'Test Widget',
                    fetchData: async () => testData
                }),
                'test-plugin'
            );

            const widgets = await service.fetchWidgetsForRoute('/', {});

            expect(widgets[0]).toEqual({
                id: 'data-widget',
                zone: 'main-after',
                pluginId: 'test-plugin',
                order: 100,
                title: 'Test Widget',
                data: testData
            });
        });

        it('should pass route and params to fetchData', async () => {
            const fetchDataSpy = vi.fn().mockResolvedValue({ received: true });
            await service.register(
                createWidget({
                    id: 'context-widget',
                    routes: ['/u/TXyz123'],
                    fetchData: fetchDataSpy
                }),
                'plugin'
            );

            const params = { address: 'TXyz123' };
            await service.fetchWidgetsForRoute('/u/TXyz123', params);

            expect(fetchDataSpy).toHaveBeenCalledWith('/u/TXyz123', params);
        });
    });

    describe('getWidgetsByZone', () => {
        it('should filter widgets by zone', async () => {
            await service.register(
                createWidget({ id: 'after1', zone: 'main-after' }),
                'plugin'
            );
            await service.register(
                createWidget({ id: 'after2', zone: 'main-after' }),
                'plugin'
            );
            await service.register(
                createWidget({ id: 'before1', zone: 'main-before' }),
                'plugin'
            );

            const afterWidgets = service.getWidgetsByZone('main-after');
            const beforeWidgets = service.getWidgetsByZone('main-before');

            expect(afterWidgets).toHaveLength(2);
            expect(beforeWidgets).toHaveLength(1);
        });

        it('should sort by order', async () => {
            await service.register(
                createWidget({ id: 'second', zone: 'main-after', order: 20 }),
                'plugin'
            );
            await service.register(
                createWidget({ id: 'first', zone: 'main-after', order: 10 }),
                'plugin'
            );

            const widgets = service.getWidgetsByZone('main-after');

            expect(widgets[0].id).toBe('first');
            expect(widgets[1].id).toBe('second');
        });

        it('should return empty array for empty zone', async () => {
            const widgets = service.getWidgetsByZone('sidebar-top');
            expect(widgets).toEqual([]);
        });
    });

    describe('getAllWidgets', () => {
        it('should return all registered widgets', async () => {
            await service.register(createWidget({ id: 'w1' }), 'p1');
            await service.register(createWidget({ id: 'w2' }), 'p2');
            await service.register(createWidget({ id: 'w3' }), 'p3');

            const widgets = service.getAllWidgets();
            expect(widgets).toHaveLength(3);
        });

        it('should return empty array when no widgets registered', () => {
            const widgets = service.getAllWidgets();
            expect(widgets).toEqual([]);
        });
    });
});
