/**
 * @file 001_saved_prompt_triggers.ts
 *
 * Folds the pre-6.4 flat saved-prompt scheduling fields into the unified
 * `triggers[]` array. A prompt that carried a `cron` expression becomes a
 * single `kind: 'cron'` trigger element preserving its enabled flag, anchor,
 * and run bookkeeping (`lastRunAt` / `lastRunError` / `failureCount`); every
 * document then has the legacy top-level fields removed so the schema is
 * clean rather than dual-shaped. Without this migration, existing scheduled
 * prompts would silently stop firing — the runner now reads only
 * `triggers[]`.
 */

import { randomUUID } from 'node:crypto';
import type { IMigration, IMigrationContext } from '@/types';

/** Collection owned by the ai-tools module (manual `module_<id>_` prefix). */
const COLLECTION = 'module_ai-tools_prompts';

/** Legacy pre-triggers document shape, as stored before this migration. */
interface ILegacyPromptDoc {
    id: string;
    cron?: string | null;
    scheduleEnabled?: boolean;
    lastRunAt?: string;
    scheduleAnchorAt?: string;
    lastRunError?: string | null;
    failureCount?: number;
}

export const migration: IMigration = {
    id: '001_saved_prompt_triggers',
    description: 'Fold legacy saved-prompt cron/scheduleEnabled fields into the unified triggers[] array',
    dependencies: [],

    async up(context: IMigrationContext): Promise<void> {
        const collection = context.database.getCollection<ILegacyPromptDoc>(COLLECTION);
        const docs = await collection.find({}).toArray();

        for (const doc of docs) {
            const update: Record<string, unknown> = {
                $unset: {
                    cron: '',
                    scheduleEnabled: '',
                    lastRunAt: '',
                    scheduleAnchorAt: '',
                    lastRunError: '',
                    failureCount: ''
                }
            };

            // Only a real cron expression becomes a trigger; a null (explicit
            // clear) or absent cron leaves the prompt manual-only. Bookkeeping
            // carries over so the migrated trigger neither re-fires an old
            // occurrence (lastRunAt/anchorAt preserved) nor forgets an
            // in-progress failure streak.
            if (typeof doc.cron === 'string' && doc.cron.trim()) {
                const trigger: Record<string, unknown> = {
                    id: randomUUID(),
                    kind: 'cron',
                    enabled: doc.scheduleEnabled !== false,
                    cron: doc.cron.trim()
                };
                if (doc.scheduleAnchorAt !== undefined) {
                    trigger.anchorAt = doc.scheduleAnchorAt;
                }
                if (doc.lastRunAt !== undefined) {
                    trigger.lastRunAt = doc.lastRunAt;
                }
                if (doc.lastRunError !== undefined) {
                    trigger.lastRunError = doc.lastRunError;
                }
                if (doc.failureCount !== undefined) {
                    trigger.failureCount = doc.failureCount;
                }
                update.$set = { triggers: [trigger] };
            }

            await collection.updateOne({ id: doc.id }, update);
        }
    }
};
