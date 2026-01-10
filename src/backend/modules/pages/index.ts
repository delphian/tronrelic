/**
 * Pages module entry point.
 *
 * Exports the PagesModule class implementing IModule for two-phase initialization
 * with dependency injection. Also exports public services and types for external
 * consumers.
 */

// Primary module export
export { PagesModule } from './PagesModule.js';
export type { IPagesModuleDependencies } from './PagesModule.js';

// Services (for external consumers if needed)
export { PageService } from './services/page.service.js';
export { MarkdownService } from './services/markdown.service.js';

// Storage providers (for external consumers or custom configurations)
export { StorageProvider } from './services/storage/StorageProvider.js';
export { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';

// HTTP layer (for testing or custom router configurations)
export { PagesController } from './api/pages.controller.js';
export { createPagesRouter } from './api/pages.routes.js';
export { createPublicPagesRouter } from './api/pages.public-routes.js';

// Database types (for external consumers working with page data)
export type { IPageDocument, IPageFileDocument, IPageSettingsDocument } from './database/index.js';
export { DEFAULT_PAGE_SETTINGS } from './database/index.js';
