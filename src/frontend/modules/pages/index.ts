/**
 * @fileoverview Pages frontend module entry point.
 *
 * Rendering for CMS pages managed by the backend pages module, shared by every
 * route that serves one. Server-only fetch helpers are exported from
 * `./server` instead, so a client bundle importing this barrel never pulls
 * them in.
 */

export { CmsPageArticle } from './components/CmsPageArticle';
export { PageBootstrapPanel } from './components/PageBootstrapPanel';
export type { IPublicPageResponse } from './types/IPublicPageResponse';
export type { IPublicPageRenderResponse } from './types/IPublicPageRenderResponse';
