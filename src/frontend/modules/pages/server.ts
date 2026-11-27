/**
 * @fileoverview Server-only entry point of the pages frontend module.
 *
 * The fetch helpers here read the backend's public CMS page endpoints during
 * server rendering, `resolvePageBreadcrumbs` reads the menu and localization
 * snapshot to build a page's trail, and `CmsPageArticle` renders a page body whose embedded
 * widgets reach the server-side widget fetch (`next/headers`). They are kept
 * out of the main barrel, as the localization module does with its own
 * `server.ts`, so client code cannot import them by accident; importing them
 * from a client bundle fails the production build.
 */

export { CmsPageArticle } from './components/CmsPageArticle';
export { publicPageUrl } from './lib/publicPageUrl';
export { fetchPublicPageMetadata } from './lib/fetchPublicPageMetadata';
export { fetchPublicPageRender } from './lib/fetchPublicPageRender';
export { resolvePageBreadcrumbs } from './lib/resolvePageBreadcrumbs';
export type { IBreadcrumbPage, IPageBreadcrumbDependencies } from './lib/resolvePageBreadcrumbs';
