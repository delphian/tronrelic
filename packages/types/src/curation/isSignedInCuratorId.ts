/**
 * @file isSignedInCuratorId.ts
 *
 * The one test for whether a curation decider id names a signed-in person.
 * Curation uses it to enforce `requiresSignedInCurator`, and a type uses it
 * in `applyEdit` to refuse a write no person made, so the two checks cannot
 * disagree.
 */

import { SYSTEM_DECIDER_PREFIX } from './SYSTEM_DECIDER_PREFIX.js';

/**
 * Whether a decider id names a signed-in person. The admin routes pass no id
 * for a request made with the `ADMIN_API_TOKEN` service token, and the
 * platform's own decisions use a `system:` id, so neither counts.
 *
 * @param actorId - The decider or editor id curation was handed, if any.
 * @returns True when the id is a Better Auth user id.
 */
export function isSignedInCuratorId(actorId: string | undefined): boolean {
    return typeof actorId === 'string'
        && actorId.length > 0
        && !actorId.startsWith(SYSTEM_DECIDER_PREFIX);
}
