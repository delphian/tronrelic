/**
 * Pages module type definitions.
 *
 * This module provides interfaces for custom page management including:
 * - Page documents with markdown content and frontmatter
 * - File uploads with configurable storage providers
 * - Module configuration settings
 * - Service contract for page/file/settings operations
 */

export type { IPage } from './IPage';
export type { IPageFile } from './IPageFile';
export type { IPageSettings } from './IPageSettings';
export type { IStorageProvider } from './IStorageProvider';
export type { IPageService } from './IPageService';
