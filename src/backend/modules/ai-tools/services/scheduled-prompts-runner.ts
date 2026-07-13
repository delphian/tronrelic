/**
 * @file scheduled-prompts-runner.ts
 *
 * Evaluates every saved prompt carrying an enabled cron trigger on each core
 * scheduler tick, firing each trigger whose cron has elapsed since that
 * trigger's last run. Extracted from the module so the logic can be
 * unit-tested against mock services without booting the application.
 *
 * Only the cron *due/claim* logic lives here. Everything after the claim —
 * provider resolution, owner principal resolution, system-prompt composition,
 * the query, history recording, and failure-streak bookkeeping — is the shared
 * {@link executeSavedPrompt} path, which the hook-trigger queue worker also
 * uses, so the two autonomous firing paths can never drift.
 *
 * A scheduled run is autonomous — there is no human present — so it fires
 * through the public `query({ mode: 'programmatic' })` path, which the provider
 * attributes as `triggerPath: 'programmatic'` / `actor: system`. The governor's
 * external-tool default-deny keys on `triggerPath !== 'interactive'`, so
 * unattended runs get the same protection a dedicated `'scheduled'` path would;
 * the public contract deliberately carries no trigger field, which keeps any
 * caller from claiming `interactive` to dodge that default-deny.
 */
// cron-parser v4 is a CommonJS module whose named exports Node 20's ESM loader
// cannot synthesize; default-import + destructure is the pattern Node itself
// recommends and is portable across cron-parser versions.
import cronParser from 'cron-parser';
const { parseExpression } = cronParser;
import type { ISystemLogService } from '@/types';
import type { SavedPromptsService } from './saved-prompts.service.js';
import type { EndUserResolver } from './end-user-resolver.js';
import {
    executeSavedPrompt,
    type ScheduledPromptProviderResolver,
    type ScheduledPromptSystemComposer,
    type ScheduledPromptNotifier,
    type ScheduledPromptQueryRecorder
} from './execute-saved-prompt.js';

// Re-exported so existing consumers (the module, tests) keep one import site
// for the runner's collaborator types even though they now live beside the
// shared executor.
export type {
    IScheduledPromptRunner,
    IScheduledPromptRunNotification,
    ScheduledPromptProviderResolver,
    ScheduledPromptSystemComposer,
    ScheduledPromptNotifier,
    ScheduledPromptQueryRecorder
} from './execute-saved-prompt.js';

/**
 * Fire all due cron triggers on saved prompts and persist updated run metadata.
 *
 * Fires at most once per trigger per tick: running the same trigger multiple
 * times to "catch up" on missed intervals would waste tokens and produce stale
 * analyses — one run with fresh context is always the right answer.
 *
 * Race-safe by design: the saved-prompts service writes each trigger's
 * lastRunAt / lastRunError with an array-filtered field-level `$set`, so
 * concurrent admin edits to other fields on the same document survive
 * unaltered.
 *
 * @param savedPrompts - Service owning the prompts collection.
 * @param logger - Logger for warnings and error context.
 * @param resolveProvider - Maps a prompt's optional `providerId` to the provider
 *        that should run it (pinned provider, or the active one when unpinned).
 * @param resolveEndUser - Maps a prompt's recorded `ownerUserId` to a live
 *        end-user principal at fire time. Omitted (or returning null) means the
 *        run carries no principal; a prompt that records an owner the resolver
 *        cannot resolve is failed closed rather than run under ambient authority.
 * @param composeSystemPrompt - Composes the core-injected system prompt for the
 *        run's principal (master + audience-scoped prompts, variable-expanded).
 *        Omitted means no core system prompt is injected; the provider still
 *        applies its own configured system prompt.
 * @param notify - Optional callback fired after a prompt actually runs (success
 *        or failure), so the module can dispatch a run notification to admins.
 *        Best-effort and isolated from the run loop.
 * @param recordQuery - Optional callback that persists one query-history record
 *        per run, so an autonomous prompt appears in the Query tab alongside
 *        interactive queries. Best-effort and isolated from the run loop.
 */
export async function runScheduledPrompts(
    savedPrompts: SavedPromptsService,
    logger: ISystemLogService,
    resolveProvider: ScheduledPromptProviderResolver,
    resolveEndUser?: EndUserResolver,
    composeSystemPrompt?: ScheduledPromptSystemComposer,
    notify?: ScheduledPromptNotifier,
    recordQuery?: ScheduledPromptQueryRecorder
): Promise<void> {
    const scheduled = await savedPrompts.listScheduled();

    if (scheduled.length === 0) {
        return;
    }

    const now = new Date();

    for (const p of scheduled) {
        const cronTriggers = (p.triggers ?? []).filter(
            (t): t is Extract<typeof t, { kind: 'cron' }> => t.kind === 'cron' && t.enabled !== false
        );

        for (const trigger of cronTriggers) {
            // Anchor cron evaluation at the most recent boundary that resets the
            // trigger's clock: a real run (lastRunAt) or a schedule
            // (re)configuration (anchorAt), whichever is later. createdAt is only
            // the fallback for a trigger that has neither run nor been re-anchored
            // — it must NOT join the max(), or it would dominate a legitimately
            // older lastRunAt and suppress a due run. Anchoring on the latest
            // boundary keeps a just-edited schedule from firing retroactively
            // while preserving the no-double-fire guarantee of anchoring on the
            // last actual run.
            const anchorMs = Math.max(
                trigger.lastRunAt ? Date.parse(trigger.lastRunAt) : 0,
                trigger.anchorAt ? Date.parse(trigger.anchorAt) : 0
            );
            const since = new Date(anchorMs > 0 ? anchorMs : Date.parse(p.createdAt));

            let fireDue = false;
            let nextFireTime = 0;
            try {
                // Pin cron resolution to UTC so the backend stays in lock-step with
                // any frontend countdown and never drifts if an operator sets TZ on
                // the container.
                const iter = parseExpression(trigger.cron, { currentDate: since, tz: 'UTC' });
                nextFireTime = iter.next().toDate().getTime();
                fireDue = nextFireTime <= now.getTime();
            } catch (err) {
                logger.warn(
                    { err, promptId: p.id, triggerId: trigger.id, cron: trigger.cron },
                    'Saved prompt trigger has invalid cron; skipping'
                );
                continue;
            }

            if (!fireDue) {
                continue;
            }

            // Advance lastRunAt BEFORE firing. A streaming query can run for
            // minutes; if the timestamp were only written after the query
            // returned, the next tick would evaluate the trigger against the
            // stale lastRunAt and fire it a second time while the first run is
            // still in flight. Claiming the run up front closes that window —
            // the worst case becomes a skipped run (process crash mid-query),
            // never a duplicate, which is the right trade for token-spending
            // work.
            // Clamp to the scheduled occurrence. If the wall clock stepped
            // backward (NTP correction) between capturing `now` and here, a
            // claimedAt earlier than the fired occurrence would let the next
            // tick re-resolve the same time and double-fire. max() also
            // preserves the real (later) execution time when a run is genuinely
            // delayed, so a late run never backfills.
            const claimedAt = new Date(Math.max(Date.now(), nextFireTime)).toISOString();
            try {
                await savedPrompts.recordRunResult(p.id, trigger.id, claimedAt, null);
            } catch (writeErr) {
                logger.warn(
                    { err: writeErr, promptId: p.id, triggerId: trigger.id, name: p.name },
                    'Failed to claim scheduled-prompt run; skipping this tick'
                );
                continue;
            }

            await executeSavedPrompt(
                p,
                { savedPrompts, logger, resolveProvider, resolveEndUser, composeSystemPrompt, notify, recordQuery },
                { triggerId: trigger.id, claimedAt }
            );
        }
    }
}
