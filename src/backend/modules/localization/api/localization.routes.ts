/**
 * @fileoverview Router factories for the localization module.
 *
 * Two routers because they mount at different prefixes with different
 * protection: the public reads and the frontend's observation intake at
 * `/api/localization`, and the management API behind `requireAdmin` at
 * `/api/admin/system/localization`. Admin gating and its rate limiter are
 * applied by the module at the mount site, matching the other modules.
 */

import { Router } from 'express';
import { createRateLimiter } from '../../../api/middleware/rate-limit.js';
import type { LocalizationPublicController } from './localization-public.controller.js';
import type { LocalizationAdminController } from './localization-admin.controller.js';

/**
 * Build the public router.
 *
 * The observation route is rate-limited even though it also refuses anything
 * but the frontend container, because it writes to storage. The ceiling is
 * generous: every request from the frontend shares one bucket, and a fresh
 * deploy reports every key the site renders within the first few minutes.
 *
 * The switch route is limited per visitor address rather than per process. A
 * person clicks the switcher a handful of times a visit, so thirty a minute
 * leaves room for anyone browsing and stops one client from inflating the
 * counts.
 *
 * @param controller - Public handlers.
 * @returns Router exposing `GET /config`, `GET /catalog/:language`, `POST /observations`, and `POST /switches`.
 */
export function createLocalizationPublicRouter(controller: LocalizationPublicController): Router {
    const router = Router();
    router.get('/config', controller.getConfig);
    router.get('/catalog/:language', controller.getCatalog);
    router.post(
        '/observations',
        createRateLimiter({ windowSeconds: 60, maxRequests: 600, keyPrefix: 'localization-observations' }),
        controller.postObservations
    );
    router.post(
        '/switches',
        createRateLimiter({ windowSeconds: 60, maxRequests: 30, keyPrefix: 'localization-switches' }),
        controller.postSwitch
    );
    return router;
}

/**
 * Build the admin router.
 *
 * @param controller - Admin handlers.
 * @returns Router exposing the language, route, key, translation, settings, suggestion, and switch-stats endpoints.
 */
export function createLocalizationAdminRouter(controller: LocalizationAdminController): Router {
    const router = Router();
    router.get('/languages', controller.listLanguages);
    router.post('/languages', controller.createLanguage);
    router.patch('/languages/:code', controller.updateLanguage);
    router.delete('/languages/:code', controller.deleteLanguage);
    router.get('/routes', controller.listRoutes);
    router.post('/routes', controller.createRoute);
    router.patch('/routes/:id', controller.updateRoute);
    router.delete('/routes/:id', controller.deleteRoute);
    router.get('/namespaces', controller.listNamespaces);
    router.get('/translations', controller.listTranslations);
    router.put('/translations', controller.saveTranslation);
    router.put('/translations/batch', controller.saveTranslations);
    router.delete('/translations', controller.deleteTranslation);
    router.post('/keys', controller.createKey);
    router.delete('/keys', controller.deleteKey);
    router.get('/settings', controller.getSettings);
    router.patch('/settings', controller.updateSettings);
    router.get('/switches', controller.getSwitchStats);
    // Each suggestion is a paid model call, so it carries its own ceiling on
    // top of the admin limiter. Twenty a minute is far more than anyone
    // clicking through rows needs, and stops a stuck script running up a bill.
    router.post(
        '/translation-suggestions',
        createRateLimiter({ windowSeconds: 60, maxRequests: 20, keyPrefix: 'localization-suggestions' }),
        controller.suggestTranslations
    );
    return router;
}
