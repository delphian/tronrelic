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
import { randomUUID } from 'node:crypto';
import cronParser from 'cron-parser';
const { parseExpression } = cronParser;
import type { IAiQueryOptions, IAiQueryRecord, IAiQueryResult, IToolEndUserPrincipal, ISystemLogService } from '@/types';
import type { SavedPromptsService } from './saved-prompts.service.js';
import type { EndUserResolver } from './end-user-resolver.js';
import { buildAiQueryRecord } from './ai-query-history.service.js';

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
 * Composes the core-injected system prompt (always-on master + audience-scoped
 * additional prompts) for a principal, already `{%name%}`-expanded. The module
 * supplies `(principal) => systemPromptsService.compose(principal)`. Omitted in
 * tests that do not exercise injection.
 */
export type ScheduledPromptSystemComposer = (
    principal?: IToolEndUserPrincipal | null
) => Promise<string>;

/**
 * Outcome of one scheduled prompt run, handed to the optional notifier so the
 * module can fan a notification to admins. Carries only what a notification
 * needs — the prompt's identity, whether it succeeded, the error text on
 * failure, and whether the failure auto-paused the schedule.
 */
export interface IScheduledPromptRunNotification {
    /** Saved-prompt id that ran. */
    promptId: string;
    /** Saved-prompt name, for the notification title. */
    name: string;
    /** Whether the run's query succeeded or threw. */
    status: 'success' | 'error';
    /** Error message when `status` is `'error'`. */
    error?: string;
    /** Whether the failure tripped the consecutive-failure auto-pause. */
    disabled?: boolean;
}

/**
 * Fired after a prompt actually runs (its query returns or throws). Omitted in
 * tests and in deployments without a notifications service. Best-effort: the
 * runner ignores anything the notifier does, so a notifier fault never disturbs
 * the run loop.
 */
export type ScheduledPromptNotifier = (run: IScheduledPromptRunNotification) => void;

/**
 * Persists one query-history record for a scheduled run, so an autonomous cron
 * prompt shows up in the `/system/ai-tools` Query tab beside the interactive
 * queries instead of being invisible there. The module supplies
 * `(record) => queryHistory.append(record)`. Omitted in tests and in any
 * deployment that does not record history; best-effort, so the runner guards
 * the call and a persistence fault never disturbs the run loop or the
 * failure-streak bookkeeping that gates auto-pause.
 */
export type ScheduledPromptQueryRecorder = (record: IAiQueryRecord) => void | Promise<void>;

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
 * @param composeSystemPrompt - Composes the core-injected system prompt for the
 *        run's principal (master + audience-scoped prompts, variable-expanded).
 *        Omitted means no core system prompt is injected; the provider still
 *        applies its own configured system prompt.
 * @param notify - Optional callback fired after a prompt actually runs (success
 *        or failure), so the module can dispatch a run notification to admins.
 *        Best-effort and isolated from the run loop.
 * @param recordQuery - Optional callback that persists one query-history record
 *        per run, so an autonomous prompt appears in the Query tab alongside
 *        interactive queries. Best-effort and isolated from the run loop; a
 *        persistence fault never disturbs the run or its failure bookkeeping.
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

        // Identifiers for this run's Query-tab history record, captured before
        // the query so both the success and failure branches share them. Each
        // run gets its own conversationId because the History view only surfaces
        // records that carry one (a record without it is a hidden one-shot) — a
        // unique id makes the scheduled turn a reopenable one-turn conversation.
        // `queryStartedAt` dates the row from the run's start, matching the
        // interactive path, and stays in scope for the failure branch below.
        const queryStartedAt = new Date().toISOString();
        const historyId = randomUUID();
        const historyConversationId = randomUUID();

        try {
            logger.info(
                { promptId: p.id, name: p.name, cron: p.cron, providerId: p.providerId, model: p.model, ownerUserId: p.ownerUserId },
                'Running scheduled prompt'
            );
            // Compose the core-injected system prompt for this run's principal:
            // the always-on master plus any audience-scoped prompts that match
            // the owner. A composer failure must not abort the run — degrade to
            // no injection (the provider still applies its own configured prompt)
            // and let the query proceed, mirroring the controller's defensive
            // compose. An unowned prompt composes against a null principal, so it
            // receives only the (non-blank) master.
            let injectedSystemPrompt: string | undefined;
            if (composeSystemPrompt) {
                try {
                    injectedSystemPrompt = await composeSystemPrompt(endUser ?? null);
                } catch (composeErr) {
                    logger.warn(
                        { err: composeErr, promptId: p.id, name: p.name },
                        'Failed to compose injected system prompt for scheduled run; proceeding without it'
                    );
                }
            }
            // Autonomous run → programmatic mode. The provider derives
            // triggerPath: 'programmatic' / actor: system from this, so the
            // governor's external-tool default-deny applies (no human present).
            // `endUser`, when the prompt records an owner, is the live principal
            // the run acts on behalf of. `model` is the optional per-query
            // override (undefined → provider's configured default).
            const result = (await provider.query({ prompt: p.prompt, model: p.model, mode: 'programmatic', endUser, injectedSystemPrompt })) as IAiQueryResult;
            // Record the run in the core query history so it surfaces in the
            // Query tab beside interactive queries. Tagged `scheduled` to mark
            // it autonomous; the provider transport above stays `programmatic`,
            // so this label never relaxes the governor's default-deny. Wrapped
            // best-effort: a history fault must not fail an otherwise-good run.
            if (recordQuery) {
                try {
                    await recordQuery(
                        buildAiQueryRecord('scheduled', p.prompt, historyConversationId, queryStartedAt, historyId, result, null, p.model)
                    );
                } catch (historyErr) {
                    logger.warn(
                        { err: historyErr, promptId: p.id, name: p.name },
                        'Failed to record scheduled-prompt query history'
                    );
                }
            }
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
            // Tell admins the run finished. Wrapped so a notifier fault cannot
            // disturb the run loop or mask the successful query.
            try {
                notify?.({ promptId: p.id, name: p.name, status: 'success' });
            } catch (notifyErr) {
                logger.warn({ err: notifyErr, promptId: p.id }, 'Scheduled-prompt success notification failed');
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
            let autoDisabled = false;
            try {
                const { disabled } = await savedPrompts.recordRunFailure(p.id, claimedAt, lastRunError);
                autoDisabled = disabled;
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
            try {
                notify?.({ promptId: p.id, name: p.name, status: 'error', error: lastRunError, disabled: autoDisabled });
            } catch (notifyErr) {
                logger.warn({ err: notifyErr, promptId: p.id }, 'Scheduled-prompt failure notification failed');
            }
            // Record the failed run too, so a broken scheduled prompt is visible
            // in the Query tab with its error rather than only on its saved-prompt
            // banner. Best-effort, mirroring the success branch.
            if (recordQuery) {
                try {
                    await recordQuery(
                        buildAiQueryRecord('scheduled', p.prompt, historyConversationId, queryStartedAt, historyId, null, lastRunError, p.model)
                    );
                } catch (historyErr) {
                    logger.warn(
                        { err: historyErr, promptId: p.id, name: p.name },
                        'Failed to record failed scheduled-prompt query history'
                    );
                }
            }
        }
    }
}
