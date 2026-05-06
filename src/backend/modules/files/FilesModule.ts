/**
 * Files module — owns the unified file inventory and upload-policy
 * settings. Publishes `IFileService` on the service registry as `'files'`
 * during `run()` so other modules and plugins consume bytes through a
 * single source of truth, regardless of storage backend.
 */

import type { Express, Router } from 'express';
import path from 'path';
import fs from 'fs/promises';
import type {
    IDatabaseService,
    IFileService,
    IFilesSettingsService,
    IMenuService,
    IModule,
    IModuleMetadata,
    IServiceRegistry,
    IStorageProvider
} from '@/types';
import { logger } from '../../lib/logger.js';
import { MAIN_SYSTEM_CONTAINER_ID } from '../menu/index.js';
import { FileService } from './services/file.service.js';
import { FilesSettingsService } from './services/files-settings.service.js';
import { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';
import { FilesController } from './api/files.controller.js';
import { createFilesRouter } from './api/files.routes.js';
import { requireAdmin } from '../../api/middleware/admin-auth.js';

/**
 * Files module dependencies. Initialized before Pages so the
 * `/system/files` menu item and `/api/admin/files` routes exist by the
 * time the Pages editor links to stored files.
 */
export interface IFilesModuleDependencies {
    database: IDatabaseService;
    menuService: IMenuService;
    app: Express;
    serviceRegistry: IServiceRegistry;
}

/**
 * Files module class. See [files/README.md](./README.md) for architecture.
 */
export class FilesModule implements IModule<IFilesModuleDependencies> {
    readonly metadata: IModuleMetadata = {
        id: 'files',
        name: 'Files',
        version: '1.0.0',
        description: 'Unified file inventory and upload-policy settings'
    };

    private database!: IDatabaseService;
    private menuService!: IMenuService;
    private app!: Express;
    private serviceRegistry!: IServiceRegistry;
    private storageProvider!: IStorageProvider;
    private settingsService!: FilesSettingsService;
    private fileService!: FileService;
    private controller!: FilesController;

    private readonly logger = logger.child({ module: 'files' });

    /**
     * Ensure the local uploads directory exists before Express static
     * middleware tries to serve from it. Avoids a 500 on the first
     * request to an uploaded file when the directory has not yet been
     * created.
     */
    private async ensureUploadsDirectoryExists(): Promise<void> {
        const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
        try {
            await fs.mkdir(uploadsDir, { recursive: true });
            this.logger.info({ uploadsDir }, 'Uploads directory created or already exists');
        } catch (error) {
            this.logger.error({ error, uploadsDir }, 'Failed to create uploads directory');
            throw new Error(
                `Failed to create uploads directory: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    async init(dependencies: IFilesModuleDependencies): Promise<void> {
        this.logger.info('Initializing files module...');

        this.database = dependencies.database;
        this.menuService = dependencies.menuService;
        this.app = dependencies.app;
        this.serviceRegistry = dependencies.serviceRegistry;

        await this.ensureUploadsDirectoryExists();

        this.storageProvider = new LocalStorageProvider();

        FilesSettingsService.setDependencies(this.database, this.logger);
        this.settingsService = FilesSettingsService.getInstance();

        FileService.setDependencies(this.database, this.storageProvider, this.settingsService, this.logger);
        this.fileService = FileService.getInstance();

        this.controller = new FilesController(this.fileService, this.settingsService, this.logger);

        this.logger.info('Files module initialized');
    }

    async run(): Promise<void> {
        this.logger.info('Running files module...');

        // Publish the unified inventory before menu/route registration so
        // that any module's run() that comes after ours can consume it via
        // the service registry without a hard import dependency.
        this.serviceRegistry.register<IFileService>('files', this.fileService);

        try {
            await this.menuService.create({
                namespace: 'main',
                label: 'Files',
                url: '/system/files',
                icon: 'Files',
                order: 42,
                parent: MAIN_SYSTEM_CONTAINER_ID,
                enabled: true
            });
            this.logger.info('Files menu item registered under the System container');
        } catch (error) {
            this.logger.error({ error }, 'Failed to register files menu item');
            throw new Error(
                `Failed to register files menu item: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }

        const router: Router = createFilesRouter(this.controller);
        this.app.use('/api/admin/files', requireAdmin, router);
        this.logger.info('Admin files router mounted at /api/admin/files');

        this.logger.info('Files module running');
    }

    /**
     * Accessor for the `FileService` singleton, exposed for tests and
     * tooling. Application code should consume `IFileService` from the
     * service registry under the name `'files'` instead of reaching
     * through this accessor. Should only be called after `init()`
     * completes.
     */
    getFileService(): FileService {
        if (!this.fileService) {
            throw new Error('FilesModule not initialized - call init() first');
        }
        return this.fileService;
    }
}
