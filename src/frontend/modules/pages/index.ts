/**
 * @fileoverview Pages frontend module entry point.
 *
 * What a client bundle may import from the pages module: the Bootstrap panel
 * the tools module and plugins render, and the public page response types.
 * Anything that reaches server-only code, such as `next/headers`, is exported
 * from `./server` instead. That includes `CmsPageArticle`, whose widget
 * rendering imports the server-side widget fetch; exported here, it pulled
 * that fetch into every client bundle that imported this barrel and failed
 * the production build.
 */

export { PageBootstrapPanel } from './components/PageBootstrapPanel';
export type { IPublicPageResponse } from './types/IPublicPageResponse';
export type { IPublicPageRenderResponse } from './types/IPublicPageRenderResponse';
