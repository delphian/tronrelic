/**
 * Pages module type definitions.
 *
 * This module provides interfaces for custom page management including:
 * - Page documents with markdown content and frontmatter
 * - File uploads with configurable storage providers
 * - Module configuration settings
 * - Service contracts for page/file/settings operations
 * - Markdown parsing and rendering with caching
 */

export type { IPage } from './IPage.js';
export type { IPageFile } from './IPageFile.js';
export type { IPageSettings } from './IPageSettings.js';
export type { IStorageProvider } from './IStorageProvider.js';
export type { IPageService } from './IPageService.js';
export type {
    IFileService,
    IFileRecord,
    IFileSource,
    IFileUploadOptions,
    IFileListFilter
} from './IFileService.js';
export { FILE_SOURCE_KINDS, FileValidationError, FileSizeExceededError } from './IFileService.js';
export type { IMarkdownService, IFrontmatterData, IParsedMarkdown } from './IMarkdownService.js';
