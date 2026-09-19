/**
 * @fileoverview Builds the content actor for a request that passed the
 * `requireAdmin` middleware.
 *
 * `requireAdmin` admits two very different callers: a signed-in member of the
 * admin group, and anyone holding the shared `ADMIN_API_TOKEN`. Only the first
 * is a person who can take responsibility for approving content, so only the
 * first is a curator. A service-token write is recorded under the stand-in id
 * `system:service-token` and held for review like any other automated write.
 * Keeping the rule in one helper stops each admin route deciding it differently.
 *
 * @module backend/services/content-actor
 */

import type { Request } from 'express';
import type { IContentActor } from '@/types';

/** Stand-in actor id recorded for a write made with the shared admin token. */
export const SERVICE_TOKEN_ACTOR_ID = 'system:service-token';

/**
 * Derive the content actor from a request `requireAdmin` has already tagged.
 *
 * @param req - An Express request that passed `requireAdmin`, carrying
 *   `adminVia` and, on the session path, `userId`.
 * @returns A curator actor for a signed-in admin, otherwise the non-curator
 *   service-token stand-in.
 */
export function actorFromAdminRequest(req: Request): IContentActor {
    let actor: IContentActor = { id: SERVICE_TOKEN_ACTOR_ID, kind: 'system', isCurator: false };
    if (req.adminVia === 'user' && typeof req.userId === 'string' && req.userId.length > 0) {
        actor = { id: req.userId, kind: 'user', isCurator: true };
    }

    return actor;
}
