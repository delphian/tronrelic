/**
 * @fileoverview Express router for the public SSR hook endpoints.
 *
 * @module backend/hooks/api/ssr.routes
 */

import { Router } from 'express';
import type { SsrHeadFragmentsController } from './ssr-head-fragments.controller.js';
import type { SsrHtmlAttributesController } from './ssr-html-attributes.controller.js';

/**
 * Build the public SSR router. Mounted under `/api/ssr` with no auth
 * middleware — the SSR layer is the only consumer and the surface
 * carries no privileged data.
 *
 * @param fragments - Controller backing the head-fragments hook.
 * @param htmlAttributes - Controller backing the html-attributes hook.
 * @returns Express router with one endpoint per SSR seam.
 */
export function createSsrRouter(
    fragments: SsrHeadFragmentsController,
    htmlAttributes: SsrHtmlAttributesController
): Router {
    const router = Router();
    router.post('/head-fragments', fragments.getFragments);
    router.post('/html-attributes', htmlAttributes.getAttributes);

    return router;
}
