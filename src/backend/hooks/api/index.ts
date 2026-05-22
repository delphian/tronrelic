/**
 * @fileoverview Barrel for the hook-introspection HTTP surface.
 *
 * @module backend/hooks/api
 */

export { HooksController } from './hooks.controller.js';
export { createHooksAdminRouter } from './hooks.routes.js';
export { SsrHeadFragmentsController } from './ssr-head-fragments.controller.js';
export { SsrHtmlAttributesController } from './ssr-html-attributes.controller.js';
export { createSsrRouter } from './ssr.routes.js';
