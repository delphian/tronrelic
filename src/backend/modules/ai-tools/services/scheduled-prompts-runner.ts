/**
 * @file scheduled-prompts-runner.ts
 *
 * Evaluates every saved prompt that carries a cron expression on each core
 * scheduler tick, firing those whose cron has elapsed since the prompt's last
 * run. Extracted from the module so the logic can be unit-tested against mock
 * services without booting the application.
 *
 * Execution is provider-neutral: the module's scheduler handler resolves the
 * active provider from the core `'ai-providers'` registry (`getActive()`) and
 * passes it in. A scheduled run is autonomous — there is no human present — so
 * it fires through the public `query({ mode: 'programmatic' })` path, which the
 * provider attributes as `triggerPath: 'programmatic'` / `actor: system`. The
 * governor's external-tool default-deny keys on `triggerPath !== 'interactive'`,
 * so unattended runs get the same protection a dedicated `'scheduled'` path
 * would; the public contract deliberately carries no trigger field, which keeps
 * any caller from claiming `interactive` to dodge that default-deny.
 */
// cron-parser v4 is a CommonJS module whose named exports Node 20's ESM loader
// cannot synthesize; default-import + destructure is the pattern Node itself
// recommends and is portable across cron-parser versions.
import cronParser from 'cron-parser';
const { parseExpression } = cronParser;
import type { IAiQueryOptions, ISystemLogService } from '@/types';
import type { SavedPromptsService } from './saved-prompts.service.js';

/**
 * Minimum contract the runner needs from the active AI provider. Declared here
 * rather than importing the full `IAiProvider` so tests can pass a plain mock
 * with a single `query` method. `IAiProvider` satisfies it structurally.
 */
export interface IScheduledPromptRunner {
    query(options: IAiQueryOptions): Promise<unknown>;
}

/**
 * Fire all due scheduled prompts and persist updated run metadata.
 *
 * Fires at most once per prompt per tick: running the same prompt multiple
 * times to "catch up" on missed intervals would waste tokens and produce stale
 * analyses — one run with fresh context is always the right answer.
 *
 * Race-safe by design: the saved-prompts service writes lastRunAt / lastRunError
 * with a field-level `$set`, so concurrent admin edits to other fields on the
 * same document survive unaltered.
 *
 * @param savedPrompts - Service owning the prompts collection.
 * @param logger - Logger for warnings and error context.
 * @param provider - Active AI provider used to execute each due prompt.
 */
export async function runScheduledPrompts(
    savedPrompts: SavedPromptsService,
    logger: ISystemLogService,
    provider: IScheduledPromptRunner
): Promise<void> {
    const scheduled = await savedPrompts.listScheduled();

    if (scheduled.length === 0) {
        return;
    }

    const now = new Date();

    for (const p of scheduled) {
        const sinceStr = p.lastRunAt || p.createdAt;
        const since = new Date(sinceStr);

        let fireDue = false;
        try {
            // Pin cron resolution to UTC so the backend stays in lock-step with
            // any frontend countdown and never drifts if an operator sets TZ on
            // the container.
            const iter = parseExpression(p.cron as string, { currentDate: since, tz: 'UTC' });
            const next = iter.next().toDate();
            fireDue = next.getTime() <= now.getTime();
        } catch (err) {
            logger.warn(
                { err, promptId: p.id, cron: p.cron },
                'Saved prompt has invalid cron; skipping'
            );
            continue;
        }

        if (!fireDue) {
            continue;
        }

        // Advance lastRunAt BEFORE firing. A streaming query can run for minutes;
        // if the timestamp were only written after the query returned, the next
        // tick would evaluate the prompt against the stale lastRunAt and fire it
        // a second time while the first run is still in flight. Claiming the run
        // up front closes that window — the worst case becomes a skipped run
        // (process crash mid-query), never a duplicate, which is the right trade
        // for token-spending work.
        const claimedAt = new Date().toISOString();
        try {
            await savedPrompts.recordRunResult(p.id, claimedAt, null);
        } catch (writeErr) {
            logger.warn(
                { err: writeErr, promptId: p.id, name: p.name },
                'Failed to claim scheduled-prompt run; skipping this tick'
            );
            continue;
        }

        try {
            logger.info(
                { promptId: p.id, name: p.name, cron: p.cron },
                'Running scheduled prompt'
            );
            // Autonomous run → programmatic mode. The provider derives
            // triggerPath: 'programmatic' / actor: system from this, so the
            // governor's external-tool default-deny applies (no human present).
            await provider.query({ prompt: p.prompt, mode: 'programmatic' });
            // Success ends any failure streak so intermittent errors never
            // accumulate toward the auto-pause threshold. Best-effort.
            try {
                await savedPrompts.resetRunFailures(p.id);
            } catch (writeErr) {
                logger.warn(
                    { err: writeErr, promptId: p.id, name: p.name },
                    'Failed to reset scheduled-prompt failure streak'
                );
            }
        } catch (err) {
            const lastRunError = err instanceof Error ? err.message : String(err);
            logger.error(
                { err, promptId: p.id, name: p.name },
                'Scheduled prompt execution failed'
            );
            // Best-effort failure stamp; the run is already claimed, so a failure
            // here only loses the error banner, never duplicates. Consecutive
            // failures accumulate and eventually auto-pause the schedule so a
            // broken prompt stops refailing every tick.
            try {
                const { disabled } = await savedPrompts.recordRunFailure(p.id, claimedAt, lastRunError);
                if (disabled) {
                    logger.error(
                        { promptId: p.id, name: p.name },
                        'Scheduled prompt auto-paused after consecutive failures'
                    );
                }
            } catch (writeErr) {
                logger.warn(
                    { err: writeErr, promptId: p.id, name: p.name },
                    'Failed to persist scheduled-prompt run error'
                );
            }
        }
    }
}
