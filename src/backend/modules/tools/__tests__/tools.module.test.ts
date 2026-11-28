/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the ToolsModule.
 *
 * Verifies two-phase lifecycle, dependency injection, menu registration,
 * route mounting, and fail-fast error propagation following the patterns
 * established by the pages module test suite.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/** Mock TronWeb instance with address utilities and signature verification. */
const mockTronWeb = {
    address: {
        toHex: vi.fn((addr: string) => '41' + 'a'.repeat(40)),
        fromHex: vi.fn((hex: string) => 'T' + 'a'.repeat(33))
    },
    trx: {
        // The real library returns the recovered signer address, never a boolean.
        verifyMessageV2: vi.fn().mockResolvedValue('T' + 'a'.repeat(33))
    },
    setHeader: vi.fn()
};

vi.mock('../../blockchain/tron-grid.client.js', () => ({
    TronGridClient: {
        getInstance: vi.fn(() => ({
            createTronWeb: vi.fn(() => mockTronWeb)
        }))
    }
}));

import { ToolsModule } from '../index.js';
import type { ICacheService, IChainParameters, IChainParametersService, IMenuService, IServiceRegistry } from '@/types';
import {
    ENERGY_ESTIMATOR_WIDGET_TYPE_ID,
    STAKE_CALCULATOR_WIDGET_TYPE_ID,
    STAKING_REWARDS_WIDGET_TYPE_ID,
    TIMESTAMP_CONVERTER_WIDGET_TYPE_ID,
    TOOLS_JOB_PREFIX
} from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';

/**
 * Mock CacheService implementing ICacheService.
 *
 * All methods are no-ops — the test suite verifies module lifecycle,
 * not cache behavior.
 */
class MockCacheService implements ICacheService {
    async get<T = any>(): Promise<T | null> {
        return null;
    }

    async set<T = any>(): Promise<void> {
        // No-op
    }

    async del(): Promise<number> {
        return 0;
    }

    async invalidate(): Promise<void> {
        // No-op
    }

    async keys(): Promise<string[]> {
        return [];
    }
}

/**
 * Mock MenuService implementing IMenuService.
 *
 * Uses vi.fn() for all methods so assertions can verify call counts,
 * arguments, and rejection behavior.
 */
class MockMenuService implements IMenuService {
    create = vi.fn().mockResolvedValue({ _id: 'mock-container-id' });
    update = vi.fn();
    delete = vi.fn();
    getNode = vi.fn();
    getTree = vi.fn(() => ({ all: [], roots: [], generatedAt: new Date() }));
    getTreeAdminView = vi.fn(() => ({ all: [], roots: [], generatedAt: new Date() }));
    getTreeForUser = vi.fn(async () => ({ all: [], roots: [], generatedAt: new Date() }));
    getChildren = vi.fn(() => []);
    getChildrenForUser = vi.fn(async () => []);
    getNamespaces = vi.fn(() => []);
    initialize = vi.fn();
    subscribe = vi.fn();
    unsubscribe = vi.fn();
    emit = vi.fn();
    getNamespaceConfig = vi.fn(async () => ({
        namespace: 'main',
        hamburgerMenu: { enabled: true, triggerWidth: 768 },
        icons: { enabled: true, position: 'left' as const },
        layout: { orientation: 'horizontal' as const },
        styling: { compact: false, showLabels: true }
    }));
    setNamespaceConfig = vi.fn();
    deleteNamespaceConfig = vi.fn();
}

/**
 * Mock Express app for testing route mounting.
 */
class MockExpressApp {
    use = vi.fn();
    get = vi.fn();
    post = vi.fn();
    put = vi.fn();
    patch = vi.fn();
    delete = vi.fn();
}

/**
 * Mock ChainParametersService implementing IChainParametersService.
 *
 * Returns realistic network parameter values for testing.
 */
class MockChainParametersService implements IChainParametersService {
    async init(): Promise<boolean> {
        return true;
    }

    async getParameters(): Promise<IChainParameters> {
        return {
            network: 'mainnet',
            parameters: {
                totalEnergyLimit: 180_000_000_000,
                totalEnergyCurrentLimit: 180_000_000_000,
                totalFrozenForEnergy: 32_000_000,
                energyPerTrx: 280,
                energyFee: 420,
                totalBandwidthLimit: 43_200_000_000,
                totalFrozenForBandwidth: 1_000_000,
                bandwidthPerTrx: 1500
            },
            fetchedAt: new Date(),
            createdAt: new Date()
        };
    }

    getEnergyFromTRX(trx: number): number {
        return Math.floor(trx * 280);
    }

    getBandwidthFromTRX(trx: number): number {
        return Math.floor(trx * 1500);
    }

    getTRXFromEnergy(energy: number): number {
        return energy / 280;
    }

    getAPY(): number {
        return 0;
    }

    getEnergyFee(): number {
        return 420;
    }
}

describe('ToolsModule', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let mockMenu: MockMenuService;
    let mockChainParams: MockChainParametersService;
    let mockServiceRegistry: IServiceRegistry;
    let mockApp: MockExpressApp;
    let mockPageBootstrap: { createCatalog: ReturnType<typeof vi.fn> };
    let mockWidgets: { registerType: ReturnType<typeof vi.fn> };
    let mockHooks: { register: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        vi.clearAllMocks();

        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        mockMenu = new MockMenuService();
        mockChainParams = new MockChainParametersService();
        mockServiceRegistry = createMockServiceRegistry({ 'chain-parameters': mockChainParams });
        mockApp = new MockExpressApp();
        mockPageBootstrap = {
            createCatalog: vi.fn(() => ({ list: vi.fn().mockResolvedValue([]), create: vi.fn() }))
        };
        mockWidgets = { registerType: vi.fn(() => () => undefined) };
        mockHooks = { register: vi.fn(() => () => undefined) };
    });

    // ============================================================================
    // Module Metadata Tests
    // ============================================================================

    describe('metadata', () => {
        it('should have correct module metadata', () => {
            const module = new ToolsModule();

            expect(module.metadata).toBeDefined();
            expect(module.metadata.id).toBe('tools');
            expect(module.metadata.name).toBe('Tools');
            expect(module.metadata.version).toBe('1.3.0');
            expect(module.metadata.description).toBeDefined();
        });
    });

    // ============================================================================
    // init() Phase Tests
    // ============================================================================

    describe('init()', () => {
        it('should initialize module with all dependencies', async () => {
            const module = new ToolsModule();

            await expect(module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            })).resolves.not.toThrow();
        });

        it('should complete init() without errors when all dependencies provided', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            // init() completing without throwing verifies dependency storage
            // and service creation (including model registration) succeeded
        });

        it('should NOT mount routes during init()', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            expect(mockApp.use).not.toHaveBeenCalled();
        });

        it('should NOT register menu items during init()', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            expect(mockMenu.create).not.toHaveBeenCalled();
        });

        it('should throw if ChainParametersService is not registered on service registry', async () => {
            const emptyRegistry = createMockServiceRegistry();
            const module = new ToolsModule();

            await expect(module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: emptyRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            })).rejects.toThrow('ChainParametersService not found on service registry');
        });

        it('should look up chain-parameters from the service registry', async () => {
            const module = new ToolsModule();
            const getSpy = vi.spyOn(mockServiceRegistry, 'get');

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            expect(getSpy).toHaveBeenCalledWith('chain-parameters');
        });
    });

    // ============================================================================
    // run() Phase Tests
    // ============================================================================

    describe('run()', () => {
        it('should throw if run() is called before init()', async () => {
            const module = new ToolsModule();

            await expect(module.run()).rejects.toThrow();
        });

        it('should register Tools container menu node during run()', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await module.run();

            expect(mockMenu.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    namespace: 'main',
                    label: 'Tools',
                    icon: 'Wrench',
                    order: 60,
                    parent: null,
                    enabled: true
                })
            );
        });

        it('should register child menu items for each tool', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await module.run();

            // 1 container + 9 children, then the /system/tools entry and its 4 tabs
            expect(mockMenu.create).toHaveBeenCalledTimes(15);

            const calls = mockMenu.create.mock.calls;

            // Verify child items reference the container parent
            const parentId = 'mock-container-id';
            const childCalls = calls.slice(1, 10);
            const childLabels = childCalls.map((c: unknown[]) => (c[0] as { label: string }).label);
            expect(childLabels).toContain('Address Converter');
            expect(childLabels).toContain('Address Generator');
            expect(childLabels).toContain('Energy Estimator');
            expect(childLabels).toContain('Stake Calculator');
            expect(childLabels).toContain('Staking Rewards');
            expect(childLabels).toContain('Signature Verifier');
            expect(childLabels).toContain('Approval Checker');
            expect(childLabels).toContain('Address Origins');
            expect(childLabels).toContain('Timestamp Converter');

            // All children reference the container parent
            for (const call of childCalls) {
                expect((call[0] as { parent: string }).parent).toBe(parentId);
            }
        });

        it('should mount tools router at /api/tools during run()', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await module.run();

            const call = mockApp.use.mock.calls.find((c: unknown[]) => c[0] === '/api/tools');
            expect(call).toBeDefined();
            expect(call![1]).toBeTypeOf('function');
        });

        it('should mount the admin router at /api/admin/tools behind the admin gate', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await module.run();

            const call = mockApp.use.mock.calls.find((c: unknown[]) => c[0] === '/api/admin/tools');
            expect(call).toBeDefined();
            // Rate limiter, requireAdmin, then the router.
            expect(call!.length).toBe(4);
        });

        /**
         * Each CMS-served tool page embeds its tool as a required widget, so a
         * widget type left unregistered would withhold that page entirely.
         */
        it('should register every CMS-served tool as an embeddable widget owned by the tools module', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });
            expect(mockWidgets.registerType).not.toHaveBeenCalled();

            await module.run();

            for (const id of [
                STAKE_CALCULATOR_WIDGET_TYPE_ID,
                STAKING_REWARDS_WIDGET_TYPE_ID,
                ENERGY_ESTIMATOR_WIDGET_TYPE_ID,
                TIMESTAMP_CONVERTER_WIDGET_TYPE_ID
            ]) {
                expect(mockWidgets.registerType).toHaveBeenCalledWith(
                    expect.objectContaining({ id, embeddable: true }),
                    'tools'
                );
            }
        });

        /**
         * The Schedules tab on /system/tools finds the module's jobs by name
         * prefix, so a job registered under any other name would never appear
         * there.
         */
        it('should register the staking rewards refresh under the tools job prefix, with the module logger, only in run()', async () => {
            const module = new ToolsModule();
            const scheduler = { register: vi.fn() };
            // A stored snapshot, so run() starts no background refresh.
            vi.spyOn(mockDatabase, 'getCollection').mockReturnValue({
                findOne: vi.fn().mockResolvedValue({ _id: 'latest', representatives: [] })
            } as any);

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any,
                scheduler: scheduler as any
            });
            expect(scheduler.register).not.toHaveBeenCalled();

            await module.run();

            expect(scheduler.register).toHaveBeenCalledTimes(1);
            const [name, , , options] = scheduler.register.mock.calls[0];
            expect(name.startsWith(TOOLS_JOB_PREFIX)).toBe(true);
            expect(options).toEqual(expect.objectContaining({ logger: expect.anything() }));
        });

        /**
         * The tool pages reach the sitemap only through this hook, since core
         * no longer lists them, so a missed registration drops them from it.
         */
        it('should declare /tools and every route-served tool page to the sitemap during run(), appending to earlier entries', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });
            expect(mockHooks.register).not.toHaveBeenCalled();

            await module.run();

            const call = mockHooks.register.mock.calls.find((c: unknown[]) => (c[1] as { id: string }).id === 'http.sitemapEntries');
            expect(call).toBeDefined();
            expect(call![0]).toBe('core');

            const handler = call![2] as (ctx: unknown, entries: Array<{ path: string }>) => Promise<Array<{ path: string }>>;
            const result = await handler({ generatedAt: new Date().toISOString() }, [{ path: '/blog' }]);
            const paths = result.map(entry => entry.path);
            expect(paths[0]).toBe('/blog');
            expect(paths).toContain('/tools');
            expect(paths).toContain('/tools/signature-verifier');
            expect(paths).toContain('/tools/address-generator');
            expect(paths).toHaveLength(7);
        });

        /**
         * The calculator, estimator, and converter addresses belong to CMS
         * pages, which the pages module lists once published. Declaring them
         * here would list an address that answers 404 before its page exists,
         * or that only redirects after an admin moves the page.
         */
        it('should leave the CMS-owned tool addresses out of its sitemap entries', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });
            await module.run();

            const call = mockHooks.register.mock.calls.find((c: unknown[]) => (c[1] as { id: string }).id === 'http.sitemapEntries');
            const handler = call![2] as (ctx: unknown, entries: Array<{ path: string }>) => Promise<Array<{ path: string }>>;
            const paths = (await handler({ generatedAt: new Date().toISOString() }, [])).map(entry => entry.path);
            expect(paths).not.toContain('/tools/stake-calculator');
            expect(paths).not.toContain('/tools/staking-rewards');
            expect(paths).not.toContain('/tools/energy-estimator');
            expect(paths).not.toContain('/tools/timestamp-converter');
            expect(paths).toHaveLength(6);
        });

        /** Pages are created only when an admin clicks Create, never at boot. */
        it('should not propose any page during the lifecycle', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });
            await module.run();
            mockServiceRegistry.register('curation', {});

            const catalog = mockPageBootstrap.createCatalog.mock.results[0].value;
            expect(mockPageBootstrap.createCatalog).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'stake-calculator' })]), expect.anything());
            expect(catalog.create).not.toHaveBeenCalled();
        });

        it('should register the /system/tools entry and its Bootstrap and Logs tabs during run()', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });
            await module.run();

            expect(mockMenu.create).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'main', url: '/system/tools' }));
            expect(mockMenu.create).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'tools-admin', url: '/system/tools?tab=bootstrap', requiresAdmin: true }));
            expect(mockMenu.create).toHaveBeenCalledWith(expect.objectContaining({ namespace: 'tools-admin', url: '/system/tools?tab=logs', requiresAdmin: true }));
        });

        it('should throw if menu registration fails', async () => {
            mockMenu.create.mockRejectedValue(new Error('Menu creation failed'));

            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await expect(module.run()).rejects.toThrow('Failed to register tools menu items');
        });
    });

    // ============================================================================
    // Two-Phase Lifecycle Tests
    // ============================================================================

    describe('two-phase lifecycle', () => {
        it('should complete full init -> run flow', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await module.run();

            expect(mockMenu.create).toHaveBeenCalled();
            expect(mockApp.use).toHaveBeenCalledTimes(2);
        });
    });

    // ============================================================================
    // Dependency Injection Tests
    // ============================================================================

    describe('dependency injection', () => {
        it('should use injected database service', async () => {
            const module = new ToolsModule();

            // Passing a different database instance proves the module uses
            // the injected dependency rather than importing its own
            const altDatabase = createMockDatabaseService();

            await module.init({
                database: altDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await module.run();

            // Module completes full lifecycle with the alternate database
        });

        it('should use injected menu service', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await module.run();

            expect(mockMenu.create).toHaveBeenCalled();
        });

        it('should use injected Express app', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await module.run();

            expect(mockApp.use).toHaveBeenCalled();
        });

        it('should use ChainParametersService from service registry', async () => {
            const module = new ToolsModule();
            const getSpy = vi.spyOn(mockServiceRegistry, 'get');

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            // The module resolved chain-parameters during init
            expect(getSpy).toHaveBeenCalledWith('chain-parameters');
        });
    });

    // ============================================================================
    // Error Handling Tests
    // ============================================================================

    describe('error handling', () => {
        it('should propagate run() errors on menu registration failure', async () => {
            mockMenu.create.mockRejectedValue(new Error('Menu error'));

            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            });

            await expect(module.run()).rejects.toThrow();
        });

        it('should fail fast when ChainParametersService is missing', async () => {
            const emptyRegistry = createMockServiceRegistry();
            const module = new ToolsModule();

            await expect(module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: emptyRegistry,
                app: mockApp as any,
                pageBootstrap: mockPageBootstrap as any,
                hookRegistry: mockHooks as any,
                widgetsService: mockWidgets as any
            })).rejects.toThrow();
        });
    });
});
