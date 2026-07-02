import type { IMigration, IMigrationContext } from '@/types';

/**
 * Add the `/blog` route family to the custom-page slug blacklist.
 *
 * **Why this migration exists**
 *
 * The catch-all route resolves custom CMS pages *before* plugin pages, so an
 * admin creating a CMS page at `/blog` (or any `/blog/...` slug) would
 * silently shadow the trp-blog plugin's list page and every post URL. The
 * default settings gained `^/blog(/.*)?$` for fresh installs; this migration
 * back-fills the same pattern into existing `page_settings` documents.
 * `$addToSet` keeps the operation idempotent — re-running it never duplicates
 * the pattern.
 */
export const migration: IMigration = {
    id: '006_add_blog_route_to_blacklist',
    description: 'Blacklist /blog and /blog/* custom-page slugs (routes owned by the trp-blog plugin)',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const pageSettings = context.database.getCollection('page_settings');

        const result = await pageSettings.updateMany({}, {
            $addToSet: {
                blacklistedRoutes: '^/blog(/.*)?$'
            }
        });

        console.log(
            `[Migration] Added /blog blacklist pattern to ${result.modifiedCount} page_settings document(s)`
        );
    }
};
