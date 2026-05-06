/**
 * Files module entry point. Owns the unified file inventory and upload
 * policy; publishes `IFileService` on the service registry as `'files'`.
 */

export { FilesModule } from './FilesModule.js';
export type { IFilesModuleDependencies } from './FilesModule.js';

export { FileService, FILES_COLLECTION } from './services/file.service.js';
export { FilesSettingsService, FILES_SETTINGS_COLLECTION } from './services/files-settings.service.js';

export { StorageProvider } from './services/storage/StorageProvider.js';
export { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';

export { FilesController } from './api/files.controller.js';
export { createFilesRouter } from './api/files.routes.js';

export type { IFileDocument, IFilesSettingsDocument } from './database/index.js';
export { DEFAULT_FILES_SETTINGS } from './database/index.js';
