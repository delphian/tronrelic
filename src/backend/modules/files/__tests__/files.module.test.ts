/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FilesModule } from '../index.js';
import { FileService } from '../services/file.service.js';
import { FilesSettingsService } from '../services/files-settings.service.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../../menu/index.js';
import type { IMenuService, IServiceRegistry } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';

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

describe('FilesModule', () => {
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockMenu: MockMenuService;
    let mockApp: MockExpressApp;
    let mockRegistry: IServiceRegistry;

    beforeEach(() => {
        vi.clearAllMocks();
        FileService.resetForTests();
        FilesSettingsService.resetForTests();
        mockDatabase = createMockDatabaseService();
        mockMenu = new MockMenuService();
        mockApp = new MockExpressApp();
        mockRegistry = createMockServiceRegistry();
    });

    describe('metadata', () => {
        it('exposes correct module metadata', () => {
            const module = new FilesModule();
            expect(module.metadata.id).toBe('files');
            expect(module.metadata.name).toBe('Files');
            expect(module.metadata.version).toBe('1.0.0');
        });
    });

    describe('init()', () => {
        it('initializes without error', async () => {
            const module = new FilesModule();
            await expect(module.init({
                database: mockDatabase,
                menuService: mockMenu,
                app: mockApp as any,
                serviceRegistry: mockRegistry
            })).resolves.not.toThrow();
        });

        it('does not mount routes during init()', async () => {
            const module = new FilesModule();
            await module.init({
                database: mockDatabase,
                menuService: mockMenu,
                app: mockApp as any,
                serviceRegistry: mockRegistry
            });
            expect(mockApp.use).not.toHaveBeenCalled();
        });

        it("does not publish 'files' on the registry during init()", async () => {
            const module = new FilesModule();
            await module.init({
                database: mockDatabase,
                menuService: mockMenu,
                app: mockApp as any,
                serviceRegistry: mockRegistry
            });
            expect(mockRegistry.has('files')).toBe(false);
        });
    });

    describe('run()', () => {
        it("publishes the unified file service on the registry as 'files'", async () => {
            const module = new FilesModule();
            await module.init({
                database: mockDatabase,
                menuService: mockMenu,
                app: mockApp as any,
                serviceRegistry: mockRegistry
            });
            await module.run();

            expect(mockRegistry.has('files')).toBe(true);
            const files = mockRegistry.get('files');
            expect(typeof (files as any).upload).toBe('function');
            expect(typeof (files as any).read).toBe('function');
            expect(typeof (files as any).list).toBe('function');
            expect(typeof (files as any).delete).toBe('function');
        });

        it('registers the Files menu item under the System container', async () => {
            const module = new FilesModule();
            await module.init({
                database: mockDatabase,
                menuService: mockMenu,
                app: mockApp as any,
                serviceRegistry: mockRegistry
            });
            await module.run();

            expect(mockMenu.create).toHaveBeenCalledWith({
                namespace: 'main',
                label: 'Files',
                url: '/system/files',
                icon: 'Files',
                order: 42,
                parent: MAIN_SYSTEM_CONTAINER_ID,
                enabled: true
            });
        });

        it('mounts the admin router at /api/admin/files', async () => {
            const module = new FilesModule();
            await module.init({
                database: mockDatabase,
                menuService: mockMenu,
                app: mockApp as any,
                serviceRegistry: mockRegistry
            });
            await module.run();

            expect(mockApp.use).toHaveBeenCalledTimes(1);
            const [path, middleware, router] = mockApp.use.mock.calls[0];
            expect(path).toBe('/api/admin/files');
            expect(typeof middleware).toBe('function');
            expect(typeof router).toBe('function');
        });

        it('throws when called before init()', async () => {
            const module = new FilesModule();
            await expect(module.run()).rejects.toThrow();
        });
    });
});
