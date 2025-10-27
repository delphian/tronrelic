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

export type { IPage } from './IPage';
export type { IPageFile } from './IPageFile';
export type { IPageSettings } from './IPageSettings';
export type { IStorageProvider } from './IStorageProvider';
export type { IPageService } from './IPageService';
export type { IMarkdownService, IFrontmatterData, IParsedMarkdown } from './IMarkdownService';
