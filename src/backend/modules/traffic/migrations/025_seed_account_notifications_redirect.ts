/**
 * @fileoverview Seeds the redirect from the retired `/account/notifications`
 * route to `/profile`.
 *
 * The route used to be a Next.js page that called `redirect('/profile')`. The
 * `(core)` loading skeleton starts streaming the response before that call
 * runs, so the server could no longer send a redirect status: visitors and
 * crawlers got a 200 page with a meta refresh, which search engines can index
 * as a page of its own. Redirects are admin-managed rules served by the edge
 * middleware, so this migration adds the rule as data and the page is gone.
 * The rule stays editable and deletable on the Redirects tab of
 * `/system/traffic`.
 */

import type { IMigration, IMigrationContext } from '@/types';

/** Physical collection the redirect service reads and writes. */
const COLLECTION_NAME = 'module_traffic_redirects';

/** The retired route. Matched exactly, since nothing ever lived beneath it. */
const PATTERN = '/account/notifications';

/** The settings hub that took over the notification preferences. */
const DESTINATION = '/profile';

/**
 * Idempotent seed of the `/account/notifications` redirect.
 */
export const migration: IMigration = {
    id: '025_seed_account_notifications_redirect',
    description:
        'Seed a permanent (301), exact-match redirect from /account/notifications to /profile into ' +
        'module_traffic_redirects, replacing the page that served a 200 with a meta refresh. ' +
        'Idempotent via $setOnInsert, so an admin edit to the rule is never clobbered.',
    dependencies: [],

    /**
     * Upsert the rule by `pattern`. `$setOnInsert` writes only when no rule
     * holds the pattern yet, so a re-run changes nothing and a rule an admin
     * already added or edited for this path is left as it is.
     *
     * @param context - Migration context providing the database service.
     */
    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection(COLLECTION_NAME);
        const now = new Date();

        const result = await collection.updateOne(
            { pattern: PATTERN },
            {
                $setOnInsert: {
                    pattern: PATTERN,
                    destination: DESTINATION,
                    isPrefix: false,
                    permanent: true,
                    enabled: true,
                    notes: 'Retired notifications page; preferences moved to the profile hub',
                    createdAt: now,
                    updatedAt: now
                }
            },
            { upsert: true }
        );

        console.log(
            result.upsertedCount > 0
                ? `[Migration] Seeded redirect ${PATTERN} -> ${DESTINATION} into ${COLLECTION_NAME}`
                : `[Migration] Redirect for ${PATTERN} already present in ${COLLECTION_NAME}; left unchanged`
        );
    }
};
