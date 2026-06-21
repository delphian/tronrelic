/**
 * @fileoverview Seed the core block-ticker placement into the site header.
 *
 * Before the widget subsystem owned the ticker, the root layout rendered
 * `<BlockTicker>` unconditionally on every page. Making the ticker a
 * placeable `core:block-ticker` widget removed that hardcoded element, so
 * the site-wide live ticker now renders only when a persisted placement
 * exists. `WidgetsModule.run()` registers the widget *type* but never a
 * placement, and migration 001 inserts no rows — so without this seed a
 * fresh or freshly-migrated deployment would show no ticker under the nav
 * until an operator created one by hand. This migration restores the
 * historical default by seeding one operator-source placement.
 *
 * The placement is `source: 'operator'` (not `plugin`) on purpose: it
 * belongs to no plugin lifecycle, and operator rows are freely
 * editable and deletable from `/system/widgets`. Because migrations run
 * exactly once per environment, an operator who later deletes or
 * reconfigures the ticker is never overridden on the next boot — the
 * completed migration does not re-run.
 *
 * Idempotent — guarded on the absence of any `core:block-ticker`
 * placement, so a retried run after a partial failure inserts nothing
 * the second time, and an environment that somehow already carries a
 * ticker placement is left untouched.
 *
 * @module backend/modules/widgets/migrations/002_seed_block_ticker_placement
 */

import type { IMigration, IMigrationContext } from '@/types';

export const migration: IMigration = {
    id: '002_seed_block_ticker_placement',
    description:
        'Seed one operator-source core:block-ticker placement into the ticker-after zone so the ' +
        'site-wide live ticker renders by default after it became a placeable widget.',
    dependencies: ['module:widgets:001_create_widget_placements'],

    async up(context: IMigrationContext): Promise<void> {
        const collection = 'module_widgets_placements';

        // String literals, never imported constants: a migration is a
        // point-in-time snapshot and must keep rendering the same effect
        // even if these ids are later renamed in code. These match
        // `BLOCK_TICKER_TYPE_ID` and the `ticker-after` zone descriptor
        // at the time of writing.
        const typeId = 'core:block-ticker';
        const zoneId = 'ticker-after';

        // Guard on any existing block-ticker placement so the seed runs
        // at most once and never fights an operator who relocated or
        // removed it. The (typeId, pluginId) unique index is sparse and
        // excludes operator rows, so it cannot enforce this for us.
        const existing = await context.database.findOne(collection, { typeId });
        if (existing) {
            return;
        }

        const now = new Date();
        await context.database.insertOne(collection, {
            typeId,
            zoneId,
            // Empty routes match every route — the ticker is global, as the
            // unconditional `<BlockTicker>` was before this PR.
            routes: [],
            // Lowest order keeps the ticker at the top of the site header,
            // directly below the nav, mirroring its historical position.
            order: 0,
            enabled: true,
            source: 'operator',
            createdAt: now,
            updatedAt: now
        });
    }
};
