/**
 * Pages module type definitions.
 *
 * Custom-page CMS types — page documents with markdown content, page-only
 * settings (route blacklist), and the page service contract. File and
 * storage types live in `@/types/files` and are consumed by Pages through
 * the `IFileService` it receives via dependency injection.
 */

export type { IPage } from './IPage.js';
export type { IPageContent } from './IPageContent.js';
export type { IPublicPage } from './IPublicPage.js';
export type { IPageSettings } from './IPageSettings.js';
export type { IPageService } from './IPageService.js';
export type { IPageListOptions } from './IPageListOptions.js';
export type { IPageListPage } from './IPageListPage.js';
export type { IPageEditProposal } from './IPageEditProposal.js';
export type { IPageEditProposalResult } from './IPageEditProposalResult.js';
export type { IPageProposal } from './IPageProposal.js';
export type { IPageProposalResult } from './IPageProposalResult.js';
export type { IPageSlugHolder } from './IPageSlugHolder.js';
export type { IPublicPageRender } from './IPublicPageRender.js';
export type { IPublicPageTranslationMetadata } from './IPublicPageTranslationMetadata.js';
export type { IPageTranslationService } from './IPageTranslationService.js';
export type { IMarkdownService, IFrontmatterData, IParsedMarkdown } from './IMarkdownService.js';
export type { PageBootstrapState } from './PageBootstrapState.js';
export type { IPageBootstrapRow } from './IPageBootstrapRow.js';
export type { IPageBootstrapItem } from './IPageBootstrapItem.js';
export type { PageBootstrapRefusalReason } from './PageBootstrapRefusalReason.js';
export type { IPageBootstrapCreateResult } from './IPageBootstrapCreateResult.js';
export type { IPageBootstrapCatalog } from './IPageBootstrapCatalog.js';
export type { IPageBootstrapService } from './IPageBootstrapService.js';
export { PAGE_BOOTSTRAP_SERVICE } from './PAGE_BOOTSTRAP_SERVICE.js';
export { PAGE_BOOTSTRAP_REFUSAL_STATUS } from './PAGE_BOOTSTRAP_REFUSAL_STATUS.js';
