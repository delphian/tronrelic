/**
 * @fileoverview Admin router for the sign-up protections.
 *
 * Mounted at `/api/admin/users/sign-ups` with `requireAdmin` at the parent.
 * It must mount before the `/api/admin/users` account router, whose `/:id`
 * route would otherwise capture `sign-ups` as an account id.
 */

import { Router } from 'express';
import type { SignUpProtectionController } from './sign-up-protection.controller.js';

/**
 * Create the sign-up protection router.
 *
 * @param controller - The sign-up protection controller.
 * @returns The configured router.
 */
export function createSignUpProtectionRouter(controller: SignUpProtectionController): Router {
    const router = Router();

    router.get('/', controller.getReport.bind(controller));
    router.put('/cap', controller.setCap.bind(controller));
    router.put('/domains/:domain', controller.putDomainRule.bind(controller));
    router.delete('/domains/:domain', controller.deleteDomainRule.bind(controller));

    return router;
}
