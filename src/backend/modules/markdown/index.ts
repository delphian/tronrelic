/**
 * @fileoverview Public API of the markdown module.
 *
 * Bootstrap imports the module class; the service is exported so other modules'
 * tests can render through the real pipeline.
 */

export { MarkdownModule, MARKDOWN_SERVICE_NAME } from './MarkdownModule.js';
export type { IMarkdownModuleDependencies } from './MarkdownModule.js';
export { MarkdownRendererService } from './services/markdown-renderer.service.js';
export type { IMarkdownRendererServiceDependencies } from './services/markdown-renderer.service.js';
