/**
 * @fileoverview Admin account-directory router factory.
 *
 * Mounts the `/system/users` dashboard's account reads at `/api/admin/users`,
 * replacing the legacy UUID user-list surface. The router is the catch-all
 * `/api/admin/users` mount, so it must register *after* the more-specific
 * `/api/admin/users/{groups,traffic,analytics}` routers (the identity module
 * mounts it last in `run()` for exactly this reason) — otherwise its `/:id`
 * matcher would shadow those prefixes.
 *
 * The per-account group editor (`PUT /:id/groups`) is composed from the
 * identity module's `UserGroupController` rather than reimplemented here, so
 * account listing and membership mutation share one admin tree without
 * coupling the accounts controller to group concerns.
 */

import { Router } from 'express';
import type { AccountsController } from './accounts.controller.js';
import type { UserGroupController } from './user-group.controller.js';

/**
 * Create the admin account-directory router.
 *
 * Routes are mounted under `/api/admin/users` with `requireAdmin` applied at
 * the parent. `/:id` is registered last so the literal `/groups` segment on
 * the membership route is matched as a sub-path, not captured as an id.
 *
 * @param controller - Account-directory read controller.
 * @param groupController - User-group controller for the membership editor.
 * @returns Configured admin accounts router.
 */
export function createAdminAccountsRouter(
    controller: AccountsController,
    groupController: UserGroupController
): Router {
    const router = Router();

    router.get('/', controller.listAccounts.bind(controller));

    // Per-account membership editor. Reuses the identity group controller.
    router.put('/:id/groups', groupController.setUserGroups.bind(groupController));

    // Registered last so the more specific `/:id/groups` path wins first.
    router.get('/:id', controller.getAccount.bind(controller));

    return router;
}

/**
 * Create the admin account-search router.
 *
 * Mounted at the dedicated literal prefix `/api/admin/accounts` (with
 * `requireAdmin` at the parent), deliberately separate from the
 * `/api/admin/users` accounts router: that one is a `/:id` catch-all, so a
 * `/search` route added there would be captured as an id. A distinct prefix
 * also gives account pickers a stable, module-neutral URL. Backs the shared
 * `context.ui.AccountPicker` typeahead.
 *
 * @param controller - Account-directory read controller.
 * @returns Configured admin account-search router.
 */
export function createAdminAccountSearchRouter(controller: AccountsController): Router {
    const router = Router();

    router.get('/search', controller.searchAccounts.bind(controller));

    return router;
}
