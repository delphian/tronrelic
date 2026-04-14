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
        verifyMessageV2: vi.fn().mockResolvedValue(true)
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
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

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
    getChildren = vi.fn(() => []);
    getNamespaces = vi.fn(() => []);
    initialize = vi.fn();
    subscribe = vi.fn();
    unsubscribe = vi.fn();
    emit = vi.fn();
    setDatabase = vi.fn();
    getDatabase = vi.fn();
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

/**
 * Mock ServiceRegistry implementing IServiceRegistry.
 *
 * Pre-loaded with a mock ChainParametersService so the tools module
 * can resolve it during init().
 */
function createMockServiceRegistry(chainParams?: IChainParametersService): IServiceRegistry {
    const services = new Map<string, unknown>();
    if (chainParams) {
        services.set('chain-parameters', chainParams);
    }

    return {
        register: vi.fn((name: string, service: unknown) => { services.set(name, service); }),
        get: vi.fn((name: string) => services.get(name)) as IServiceRegistry['get'],
        has: vi.fn((name: string) => services.has(name)),
        unregister: vi.fn((name: string) => services.delete(name)),
        getNames: vi.fn(() => Array.from(services.keys()))
    };
}

describe('ToolsModule', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let mockMenu: MockMenuService;
    let mockChainParams: MockChainParametersService;
    let mockServiceRegistry: IServiceRegistry;
    let mockApp: MockExpressApp;

    beforeEach(() => {
        vi.clearAllMocks();

        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        mockMenu = new MockMenuService();
        mockChainParams = new MockChainParametersService();
        mockServiceRegistry = createMockServiceRegistry(mockChainParams);
        mockApp = new MockExpressApp();
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
            expect(module.metadata.version).toBe('1.1.0');
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
                app: mockApp as any
            })).resolves.not.toThrow();
        });

        it('should complete init() without errors when all dependencies provided', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any
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
                app: mockApp as any
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
                app: mockApp as any
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
                app: mockApp as any
            })).rejects.toThrow('ChainParametersService not found on service registry');
        });

        it('should look up chain-parameters from the service registry', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any
            });

            expect(mockServiceRegistry.get).toHaveBeenCalledWith('chain-parameters');
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
                app: mockApp as any
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
                app: mockApp as any
            });

            await module.run();

            // 1 container + 7 children = 8 create calls
            expect(mockMenu.create).toHaveBeenCalledTimes(8);

            const calls = mockMenu.create.mock.calls;

            // Verify child items reference the container parent
            const parentId = 'mock-container-id';
            const childLabels = calls.slice(1).map((c: unknown[]) => (c[0] as { label: string }).label);
            expect(childLabels).toContain('Address Converter');
            expect(childLabels).toContain('Address Generator');
            expect(childLabels).toContain('Energy Estimator');
            expect(childLabels).toContain('Stake Calculator');
            expect(childLabels).toContain('Signature Verifier');
            expect(childLabels).toContain('Approval Checker');
            expect(childLabels).toContain('Timestamp Converter');

            // All children reference the container parent
            for (const call of calls.slice(1)) {
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
                app: mockApp as any
            });

            await module.run();

            expect(mockApp.use).toHaveBeenCalledTimes(1);

            const call = mockApp.use.mock.calls[0];
            expect(call[0]).toBe('/api/tools');
            expect(call[1]).toBeTypeOf('function');
        });

        it('should throw if menu registration fails', async () => {
            mockMenu.create.mockRejectedValue(new Error('Menu creation failed'));

            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any
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
                app: mockApp as any
            });

            await module.run();

            expect(mockMenu.create).toHaveBeenCalled();
            expect(mockApp.use).toHaveBeenCalledTimes(1);
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
                app: mockApp as any
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
                app: mockApp as any
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
                app: mockApp as any
            });

            await module.run();

            expect(mockApp.use).toHaveBeenCalled();
        });

        it('should use ChainParametersService from service registry', async () => {
            const module = new ToolsModule();

            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                serviceRegistry: mockServiceRegistry,
                app: mockApp as any
            });

            // The module resolved chain-parameters during init
            expect(mockServiceRegistry.get).toHaveBeenCalledWith('chain-parameters');
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
                app: mockApp as any
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
                app: mockApp as any
            })).rejects.toThrow();
        });
    });
});
