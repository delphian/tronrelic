/**
 * @fileoverview Server-only entry point of the pages frontend module.
 *
 * The fetch helpers here read the backend's public CMS page endpoints during
 * server rendering. They are kept out of the main barrel, as the localization
 * module does with its own `server.ts`, so client code cannot import them by
 * accident.
 */

export { publicPageUrl } from './lib/publicPageUrl';
export { fetchPublicPageMetadata } from './lib/fetchPublicPageMetadata';
export { fetchPublicPageRender } from './lib/fetchPublicPageRender';
