/**
 * @file scheduled-prompts-runner.ts
 *
 * Evaluates every saved prompt that carries a cron expression on each core
 * scheduler tick, firing those whose cron has elapsed since the prompt's last
 * run. Extracted from the module so the logic can be unit-tested against mock
 * services without booting the application.
 *
 * Execution is provider-neutral and per-prompt: the module's scheduler handler
 * passes a resolver that maps a prompt's optional `providerId` to an executable
 * provider from the core `'ai-providers'` registry — a pinned prompt routes to
 * its specific provider (`getProvider(id)`) even when that is not the active
 * one, and an unpinned prompt falls back to the active provider (`getActive()`).
 * This is why a saved prompt records both `providerId` and `model`: models span
 * providers, so the model alone cannot say which transport to run on. A prompt
 * whose pinned provider is not installed is recorded as a failed run (surfacing
 * the reason and accumulating toward auto-pause), never silently skipped.
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
import type { IAiQueryOptions, IToolEndUserPrincipal, ISystemLogService } from '@/types';
import type { SavedPromptsService } from './saved-prompts.service.js';
import type { EndUserResolver } from './end-user-resolver.js';

/**
 * Minimum contract the runner needs from an AI provider. Declared here rather
 * than importing the full `IAiProvider` so tests can pass a plain mock with a
 * single `query` method. `IAiProvider` satisfies it structurally.
 */
export interface IScheduledPromptRunner {
    query(options: IAiQueryOptions): Promise<unknown>;
}

/**
 * Resolves a prompt's optional `providerId` to an executable provider. The
 * module supplies `(id) => id ? registry.getProvider(id) : registry.getActive()`.
 * Returns `null` when the pinned provider is not installed (or, for an unpinned
 * prompt, when no provider is active), which the runner records as a failed run.
 */
export type ScheduledPromptProviderResolver = (providerId?: string) => IScheduledPromptRunner | null;

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
 * @param resolveProvider - Maps a prompt's optional `providerId` to the provider
 *        that should run it (pinned provider, or the active one when unpinned).
 * @param resolveEndUser - Maps a prompt's recorded `ownerUserId` to a live
 *        end-user principal at fire time. Omitted (or returning null) means the
 *        run carries no principal; a prompt that records an owner the resolver
 *        cannot resolve is failed closed rather than run under ambient authority.
 */
export async function runScheduledPrompts(
    savedPrompts: SavedPromptsService,
    logger: ISystemLogService,
    resolveProvider: ScheduledPromptProviderResolver,
    resolveEndUser?: EndUserResolver
): Promise<void> {
    const scheduled = await savedPrompts.listScheduled();

    if (scheduled.length === 0) {
        return;
    }

    const now = new Date();

    for (const p of scheduled) {
        // Anchor cron evaluation at the most recent boundary that resets the
        // schedule clock: a real run (lastRunAt) or a schedule (re)configuration
        // (scheduleAnchorAt), whichever is later. createdAt is only the fallback
        // for a prompt that has neither run nor been re-anchored — it must NOT
        // join the max(), or it would dominate a legitimately older lastRunAt and
        // suppress a due run. Anchoring on the latest boundary keeps a just-edited
        // schedule from firing retroactively while preserving the no-double-fire
        // guarantee of anchoring on the last actual run.
        const anchorMs = Math.max(
            p.lastRunAt ? Date.parse(p.lastRunAt) : 0,
            p.scheduleAnchorAt ? Date.parse(p.scheduleAnchorAt) : 0
        );
        const since = new Date(anchorMs > 0 ? anchorMs : Date.parse(p.createdAt));

        let fireDue = false;
        let nextFireTime = 0;
        try {
            // Pin cron resolution to UTC so the backend stays in lock-step with
            // any frontend countdown and never drifts if an operator sets TZ on
            // the container.
            const iter = parseExpression(p.cron as string, { currentDate: since, tz: 'UTC' });
            nextFireTime = iter.next().toDate().getTime();
            fireDue = nextFireTime <= now.getTime();
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
        // Clamp to the scheduled occurrence. If the wall clock stepped backward
        // (NTP correction) between capturing `now` and here, a claimedAt earlier
        // than the fired occurrence would let the next tick re-resolve the same
        // time and double-fire. max() also preserves the real (later) execution
        // time when a run is genuinely delayed, so a late run never backfills.
        const claimedAt = new Date(Math.max(Date.now(), nextFireTime)).toISOString();
        try {
            await savedPrompts.recordRunResult(p.id, claimedAt, null);
        } catch (writeErr) {
            logger.warn(
                { err: writeErr, promptId: p.id, name: p.name },
                'Failed to claim scheduled-prompt run; skipping this tick'
            );
            continue;
        }

        // Resolve the provider this prompt should run on. A pinned prompt routes
        // to its own provider even when inactive; an unpinned one uses the active
        // provider. A null result (pinned provider not installed, or no active
        // provider) is recorded as a failed run so the admin sees why it didn't
        // fire — the run is already claimed, so this never double-fires.
        const provider = resolveProvider(p.providerId);
        if (!provider) {
            const reason = p.providerId
                ? `AI provider "${p.providerId}" is not installed or enabled`
                : 'No active AI provider is installed';
            logger.warn({ promptId: p.id, name: p.name, providerId: p.providerId }, `Scheduled prompt skipped: ${reason}`);
            try {
                const { disabled } = await savedPrompts.recordRunFailure(p.id, claimedAt, reason);
                if (disabled) {
                    logger.error({ promptId: p.id, name: p.name }, 'Scheduled prompt auto-paused after consecutive failures');
                }
            } catch (writeErr) {
                logger.warn({ err: writeErr, promptId: p.id, name: p.name }, 'Failed to persist scheduled-prompt provider-unavailable error');
            }
            continue;
        }

        // Resolve the owner principal for a prompt that records one. The run
        // executes on the owner's behalf, so a tool declaring
        // operatesOnUserOwnedObjects scopes to the owner instead of being denied.
        // Re-resolved live every fire — never a snapshot — so a revoked group or
        // a deleted account takes effect on the very next run. Fail closed: an
        // owner the resolver cannot resolve records a failed run rather than
        // executing under no/stale authority (the run is already claimed, so this
        // never double-fires). A prompt with no owner runs with no principal,
        // exactly as an unattended system query does.
        let endUser: IToolEndUserPrincipal | undefined;
        if (p.ownerUserId) {
            // A throw here (transient DB error, identity service down) must fail
            // exactly like a null principal — record the failed run and move on —
            // never escape the loop. The run is already claimed, so an unguarded
            // rejection would abort every remaining prompt this tick AND leave this
            // one with an advanced lastRunAt but no recorded failure, defeating the
            // per-prompt isolation and fail-closed guarantee this branch exists for.
            let principal: IToolEndUserPrincipal | null = null;
            try {
                principal = resolveEndUser ? await resolveEndUser(p.ownerUserId) : null;
            } catch (resolveErr) {
                logger.error(
                    { err: resolveErr, promptId: p.id, name: p.name, ownerUserId: p.ownerUserId },
                    'Scheduled prompt owner resolution threw; failing closed'
                );
            }
            if (!principal) {
                const reason = `Prompt owner "${p.ownerUserId}" could not be resolved (account deleted, or identity service unavailable)`;
                logger.warn({ promptId: p.id, name: p.name, ownerUserId: p.ownerUserId }, `Scheduled prompt skipped: ${reason}`);
                try {
                    const { disabled } = await savedPrompts.recordRunFailure(p.id, claimedAt, reason);
                    if (disabled) {
                        logger.error({ promptId: p.id, name: p.name }, 'Scheduled prompt auto-paused after consecutive failures');
                    }
                } catch (writeErr) {
                    logger.warn({ err: writeErr, promptId: p.id, name: p.name }, 'Failed to persist scheduled-prompt owner-unresolved error');
                }
                continue;
            }
            endUser = principal;
        }

        try {
            logger.info(
                { promptId: p.id, name: p.name, cron: p.cron, providerId: p.providerId, model: p.model, ownerUserId: p.ownerUserId },
                'Running scheduled prompt'
            );
            // Autonomous run → programmatic mode. The provider derives
            // triggerPath: 'programmatic' / actor: system from this, so the
            // governor's external-tool default-deny applies (no human present).
            // `endUser`, when the prompt records an owner, is the live principal
            // the run acts on behalf of. `model` is the optional per-query
            // override (undefined → provider's configured default).
            await provider.query({ prompt: p.prompt, model: p.model, mode: 'programmatic', endUser });
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
