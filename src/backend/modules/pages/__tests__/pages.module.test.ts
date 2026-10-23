/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PagesModule } from '../index.js';
import type { IPagesModuleDependencies } from '../index.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../../menu/index.js';
import { PageService } from '../services/page.service.js';
import { PageTranslationService } from '../services/page-translation.service.js';
import { AI_TOOL_NAMES } from '../ai-tools.js';
import type { IAiToolRegistry, ICacheService, IMenuService, IServiceRegistry } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';

class MockCacheService implements ICacheService {
    async get<T = any>(_key: string): Promise<T | null> { return null; }
    async set<T = any>(_key: string, _value: T, _ttl?: number): Promise<void> {}
    async del(_key: string): Promise<number> { return 0; }
    async invalidate(_pattern: string): Promise<void> {}
    async keys(_pattern: string): Promise<string[]> { return []; }
}

class MockMenuService implements IMenuService {
    create = vi.fn();
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

class MockExpressApp {
    use = vi.fn();
    get = vi.fn();
    post = vi.fn();
    put = vi.fn();
    patch = vi.fn();
    delete = vi.fn();
}

describe('PagesModule', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let mockMenu: MockMenuService;
    let mockApp: MockExpressApp;
    let mockContent: { registerType: ReturnType<typeof vi.fn>; translations: () => unknown };
    let ensureValueIndexes: ReturnType<typeof vi.fn>;
    let serviceRegistry: IServiceRegistry;

    /**
     * The dependencies every test hands to `init()`, built fresh per test so
     * a test that overrides one field cannot leak into the next.
     *
     * @param overrides - Fields that differ from the shared mocks.
     * @returns The dependency object.
     */
    function deps(overrides: Partial<IPagesModuleDependencies> = {}): IPagesModuleDependencies {
        return {
            database: mockDatabase,
            cacheService: mockCache,
            menuService: mockMenu,
            contentService: mockContent as any,
            serviceRegistry,
            app: mockApp as any,
            ...overrides
        };
    }

    beforeEach(() => {
        vi.clearAllMocks();
        PageService.resetForTests();
        PageTranslationService.resetForTests();
        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        mockMenu = new MockMenuService();
        mockApp = new MockExpressApp();
        ensureValueIndexes = vi.fn(async () => undefined);
        mockContent = {
            registerType: vi.fn(() => () => undefined),
            /**
             * Stand in for the core translation service; the module only asks
             * it for the store its translated text is kept in.
             *
             * @returns A translation service with a store factory.
             */
            translations: () => ({
                createValueStore: () => ({ ensureIndexes: ensureValueIndexes, read: vi.fn(async () => []), write: vi.fn() })
            })
        };
        serviceRegistry = createMockServiceRegistry();
    });

    describe('metadata', () => {
        it('exposes correct module metadata', () => {
            const module = new PagesModule();
            expect(module.metadata.id).toBe('pages');
            expect(module.metadata.name).toBe('Pages');
            expect(module.metadata.version).toBe('1.0.0');
            expect(module.metadata.description).toBeDefined();
        });
    });

    describe('init()', () => {
        it('initializes without error', async () => {
            const module = new PagesModule();
            await expect(module.init(deps())).resolves.not.toThrow();
        });

        it('does not mount routes during init()', async () => {
            const module = new PagesModule();
            await module.init(deps());
            expect(mockApp.use).not.toHaveBeenCalled();
        });

        it('creates the translation values index during init()', async () => {
            const module = new PagesModule();
            await module.init(deps());
            expect(ensureValueIndexes).toHaveBeenCalledTimes(1);
        });

        it('does not register the page content type during init()', async () => {
            const module = new PagesModule();
            await module.init(deps());
            expect(mockContent.registerType).not.toHaveBeenCalled();
        });

        it('does not register menu items during init()', async () => {
            const module = new PagesModule();
            await module.init(deps());
            expect(mockMenu.create).not.toHaveBeenCalled();
        });

        it('does not register AI tools during init()', async () => {
            const registerTool = vi.fn();
            serviceRegistry.register('ai-tools', { registerTool, unregisterTool: vi.fn() });
            const module = new PagesModule();
            await module.init(deps());
            expect(registerTool).not.toHaveBeenCalled();
        });
    });

    describe('run()', () => {
        it('throws when called before init()', async () => {
            const module = new PagesModule();
            await expect(module.run()).rejects.toThrow();
        });

        it('registers core:page as managed content', async () => {
            const module = new PagesModule();
            await module.init(deps());
            await module.run();

            expect(mockContent.registerType).toHaveBeenCalledWith(
                expect.objectContaining({ typeId: 'core:page' }),
                'pages'
            );
        });

        it('registers core:page with a translation side and no separate translation type', async () => {
            const module = new PagesModule();
            await module.init(deps());
            await module.run();

            expect(mockContent.registerType).toHaveBeenCalledTimes(1);
            const [type] = mockContent.registerType.mock.calls[0];
            expect(type.translation.translatableFields.map((field: { name: string }) => field.name))
                .toEqual(['title', 'description', 'keywords', 'body', 'ogImage']);
        });

        it('registers the Pages menu item under the System container', async () => {
            const module = new PagesModule();
            await module.init(deps());
            await module.run();

            expect(mockMenu.create).toHaveBeenCalledWith({
                namespace: 'main',
                label: 'Pages',
                url: '/system/pages',
                icon: 'FileText',
                order: 40,
                parent: MAIN_SYSTEM_CONTAINER_ID,
                enabled: true
            });
        });

        it('mounts admin and public routers', async () => {
            const module = new PagesModule();
            await module.init(deps());
            await module.run();

            expect(mockApp.use).toHaveBeenCalledTimes(2);
            const [adminCall, publicCall] = mockApp.use.mock.calls;
            // Admin call has 4 args: path, rate-limit middleware,
            // requireAdmin middleware, router. The rate-limit
            // middleware is required for the platform-wide policy
            // CodeQL's js/missing-rate-limiting rule enforces.
            expect(adminCall).toHaveLength(4);
            expect(adminCall[0]).toBe('/api/admin/pages');
            expect(publicCall[0]).toBe('/api/pages');
        });

        it('registers the page AI tools once the ai-tools registry appears', async () => {
            const module = new PagesModule();
            await module.init(deps());
            await module.run();

            // The registry is published after this module runs, as in production.
            const registry = { registerTool: vi.fn(), unregisterTool: vi.fn() };
            serviceRegistry.register('ai-tools', registry as unknown as IAiToolRegistry);

            const registered = registry.registerTool.mock.calls.map(([tool, provider]) => [tool.name, provider]);
            expect(registered).toEqual(Object.values(AI_TOOL_NAMES).map((name) => [name, 'pages']));
        });

        it('throws when menu registration fails', async () => {
            mockMenu.create.mockRejectedValue(new Error('Menu creation failed'));
            const module = new PagesModule();
            await module.init(deps());
            await expect(module.run()).rejects.toThrow('Failed to register pages menu item');
        });
    });

    describe('error handling', () => {
        it('propagates init() errors when database is missing', async () => {
            const module = new PagesModule();
            await expect(module.init(deps({ database: null as any }))).rejects.toThrow();
        });
    });
});
