/**
 * Files module type definitions.
 *
 * Platform-wide file inventory contract published on the service registry
 * as `'files'` and the upload-policy settings the Files module owns.
 */
export type { IStorageProvider } from './IStorageProvider.js';
export type {
    IFileService,
    IFileRecord,
    IFileSource,
    IFileUploadOptions,
    IFileListFilter,
    IVariantOptions,
    IFileVariant
} from './IFileService.js';
export { FILE_SOURCE_KINDS, FileValidationError, FileSizeExceededError } from './IFileService.js';
export type { IFilesSettings, IFilesSettingsService } from './IFilesSettings.js';
