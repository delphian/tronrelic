/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PagesModule } from '../index.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../../menu/index.js';
import { PageService } from '../services/page.service.js';
import type { ICacheService, IMenuService } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

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
    getTreeForUser = vi.fn(async () => ({ all: [], roots: [], generatedAt: new Date() }));
    getChildren = vi.fn(() => []);
    getChildrenForUser = vi.fn(async () => []);
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

    beforeEach(() => {
        vi.clearAllMocks();
        PageService.resetForTests();
        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        mockMenu = new MockMenuService();
        mockApp = new MockExpressApp();
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
            await expect(module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            })).resolves.not.toThrow();
        });

        it('does not mount routes during init()', async () => {
            const module = new PagesModule();
            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });
            expect(mockApp.use).not.toHaveBeenCalled();
        });

        it('does not register menu items during init()', async () => {
            const module = new PagesModule();
            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });
            expect(mockMenu.create).not.toHaveBeenCalled();
        });
    });

    describe('run()', () => {
        it('throws when called before init()', async () => {
            const module = new PagesModule();
            await expect(module.run()).rejects.toThrow();
        });

        it('registers the Pages menu item under the System container', async () => {
            const module = new PagesModule();
            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });
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
            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });
            await module.run();

            expect(mockApp.use).toHaveBeenCalledTimes(2);
            const [adminCall, publicCall] = mockApp.use.mock.calls;
            expect(adminCall).toHaveLength(3);
            expect(adminCall[0]).toBe('/api/admin/pages');
            expect(publicCall[0]).toBe('/api/pages');
        });

        it('throws when menu registration fails', async () => {
            mockMenu.create.mockRejectedValue(new Error('Menu creation failed'));
            const module = new PagesModule();
            await module.init({
                database: mockDatabase,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            });
            await expect(module.run()).rejects.toThrow('Failed to register pages menu item');
        });
    });

    describe('error handling', () => {
        it('propagates init() errors when database is missing', async () => {
            const module = new PagesModule();
            await expect(module.init({
                database: null as any,
                cacheService: mockCache,
                menuService: mockMenu,
                app: mockApp as any
            })).rejects.toThrow();
        });
    });
});
