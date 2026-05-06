/**
 * Pages module entry point.
 *
 * File and storage primitives moved to the Files module — see
 * `src/backend/modules/files/`.
 */

export { PagesModule } from './PagesModule.js';
export type { IPagesModuleDependencies } from './PagesModule.js';

export { PageService } from './services/page.service.js';
export { MarkdownService } from './services/markdown.service.js';

export { PagesController } from './api/pages.controller.js';
export { createPagesRouter } from './api/pages.routes.js';
export { createPublicPagesRouter } from './api/pages.public-routes.js';

export type { IPageDocument, IPageSettingsDocument } from './database/index.js';
export { DEFAULT_PAGE_SETTINGS } from './database/index.js';
