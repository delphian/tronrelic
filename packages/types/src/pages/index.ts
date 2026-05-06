/**
 * Pages module type definitions.
 *
 * Custom-page CMS types — page documents with markdown content, page-only
 * settings (route blacklist), and the page service contract. File and
 * storage types live in `@/types/files` and are consumed by Pages through
 * the `IFileService` it receives via dependency injection.
 */

export type { IPage } from './IPage.js';
export type { IPageSettings } from './IPageSettings.js';
export type { IPageService } from './IPageService.js';
export type { IMarkdownService, IFrontmatterData, IParsedMarkdown } from './IMarkdownService.js';
