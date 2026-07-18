/**
 * @file execute-saved-prompt.ts
 *
 * The single execution path for an autonomous saved-prompt run, shared by the
 * cron runner (scheduled-prompts-runner.ts) and the hook-trigger queue worker
 * (AiToolsModule). Extracting it guarantees the two firing paths can never
 * drift: both resolve the prompt's pinned provider, re-resolve the owner
 * principal live (failing closed on an unresolvable owner), compose the
 * core-injected system prompt, run `query({ mode: 'programmatic' })`, record
 * one query-history row, and keep the firing trigger's failure-streak
 * bookkeeping — success resets the streak, repeated failure auto-pauses the
 * trigger.
 *
 * The caller owns *claiming* the run (writing `lastRunAt` before invoking this
 * function) because claim semantics differ by path: the cron runner claims
 * up-front to prevent a double-fire on the next tick, while the queue worker's
 * claim is the enqueued job itself. Everything after the claim is identical
 * and lives here.
 */

import { randomUUID } from 'node:crypto';
import type {
    IAiQueryOptions,
    IAiQueryRecord,
    IAiQueryResult,
    ISavedPrompt,
    IToolEndUserPrincipal,
    ISystemLogService
} from '@/types';
import type { SavedPromptsService } from './saved-prompts.service.js';
import type { EndUserResolver } from './end-user-resolver.js';
import { buildAiQueryRecord } from './ai-query-history.service.js';

/**
 * Minimum contract the executor needs from an AI provider. Declared here rather
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
 * prompt, when no provider is active), which the executor records as a failed run.
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
 * Outcome of one autonomous prompt run, handed to the optional notifier so the
 * module can fan a notification to admins. Carries only what a notification
 * needs — the prompt's identity, whether it succeeded, the error text on
 * failure, and whether the failure auto-paused the firing trigger.
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
    /** Whether the failure tripped the trigger's consecutive-failure auto-pause. */
    disabled?: boolean;
}

/**
 * Fired after a prompt actually runs (its query returns or throws). Omitted in
 * tests and in deployments without a notifications service. Best-effort: the
 * executor ignores anything the notifier does, so a notifier fault never
 * disturbs the caller.
 */
export type ScheduledPromptNotifier = (run: IScheduledPromptRunNotification) => void;

/**
 * Persists one query-history record for an autonomous run, so a cron or
 * hook-fired prompt shows up in the `/system/ai-tools` Query tab beside the
 * interactive queries instead of being invisible there. The module supplies
 * `(record) => queryHistory.append(record)`. Best-effort: the executor guards
 * the call so a persistence fault never disturbs the run or the failure-streak
 * bookkeeping that gates auto-pause.
 */
export type ScheduledPromptQueryRecorder = (record: IAiQueryRecord) => void | Promise<void>;

/** The collaborator bundle both firing paths hand to {@link executeSavedPrompt}. */
export interface ISavedPromptExecutionDeps {
    /** Service owning the prompts collection (trigger bookkeeping writes). */
    savedPrompts: SavedPromptsService;
    /** Logger for warnings and error context. */
    logger: ISystemLogService;
    /** Maps a prompt's optional `providerId` to the provider that should run it. */
    resolveProvider: ScheduledPromptProviderResolver;
    /** Maps a prompt's recorded `ownerUserId` to a live end-user principal at fire time. */
    resolveEndUser?: EndUserResolver;
    /** Composes the core-injected system prompt for the run's principal. */
    composeSystemPrompt?: ScheduledPromptSystemComposer;
    /** Optional admin-notification callback fired after the run settles. */
    notify?: ScheduledPromptNotifier;
    /** Optional query-history persister for the Query tab. */
    recordQuery?: ScheduledPromptQueryRecorder;
}

/** Per-invocation options for one autonomous run. */
export interface ISavedPromptExecutionOptions {
    /**
     * The trigger element that fired — the address every bookkeeping write
     * (failure streak, auto-pause, error banner) is scoped to. Omitted for a
     * manual "run now" that no trigger initiated: with no trigger to stamp,
     * that run skips all failure-streak bookkeeping and only records history,
     * so a hand-fired run can never auto-pause a schedule.
     */
    triggerId?: string;
    /**
     * ISO timestamp the run was claimed at, written by the caller before
     * invoking the executor and reused for the failure stamps so the banner
     * matches the claimed `lastRunAt`. Absent on a manual run (no claim, no
     * trigger stamp).
     */
    claimedAt?: string;
    /**
     * Optional per-run variable values (name → expanded text), e.g. the hook
     * payload a hook trigger carries (`hook.type-id`, `hook.ref`,
     * `hook.descriptor`). Substituted into the prompt text locally — by
     * matching `{%name%}` — before the provider sees it, because these values
     * exist only for this one run and must never enter the shared
     * prompt-variable registry. Names absent from the prompt text are ignored;
     * registry variables in the text still expand provider-side as usual.
     */
    variables?: Record<string, string>;
}

/**
 * Run one autonomous saved-prompt execution end-to-end: resolve provider and
 * owner, compose the injected system prompt, query, record history, and keep
 * the firing trigger's failure-streak bookkeeping. Never throws — every
 * failure is recorded against the trigger and (best-effort) notified, so a
 * caller loop or queue worker needs no error handling of its own.
 *
 * @param p - The saved prompt to run (a fresh read from the caller).
 * @param deps - The collaborator bundle (provider/owner resolvers, composer, sinks).
 * @param opts - The firing trigger id, the claim timestamp, and per-run variables.
 * @returns Resolves once the run and its bookkeeping have settled.
 */
export async function executeSavedPrompt(
    p: ISavedPrompt,
    deps: ISavedPromptExecutionDeps,
    opts: ISavedPromptExecutionOptions
): Promise<void> {
    const { savedPrompts, logger, resolveProvider, resolveEndUser, composeSystemPrompt, notify, recordQuery } = deps;
    const { triggerId, claimedAt } = opts;

    /**
     * Record a pre-query failure (provider missing, owner unresolvable) against
     * the firing trigger and surface the auto-pause in the log — shared by the
     * two fail-closed branches below so their bookkeeping cannot drift.
     *
     * @param reason - The caller-facing failure reason for the error banner.
     */
    const failClosed = async (reason: string): Promise<void> => {
        logger.warn({ promptId: p.id, name: p.name, triggerId }, `Saved prompt run skipped: ${reason}`);
        // A manual run has no trigger to stamp or auto-pause — the caller surfaced
        // the pre-run failure to the operator directly, so there is nothing to record.
        if (!triggerId || !claimedAt) {
            return;
        }
        try {
            const { disabled } = await savedPrompts.recordRunFailure(p.id, triggerId, claimedAt, reason);
            if (disabled) {
                logger.error({ promptId: p.id, name: p.name, triggerId }, 'Saved-prompt trigger auto-paused after consecutive failures');
            }
        } catch (writeErr) {
            logger.warn({ err: writeErr, promptId: p.id, name: p.name }, 'Failed to persist saved-prompt run error');
        }
    };

    // Resolve the provider this prompt should run on. A pinned prompt routes
    // to its own provider even when inactive; an unpinned one uses the active
    // provider. A null result (pinned provider not installed, or no active
    // provider) is recorded as a failed run so the admin sees why it didn't
    // fire — the run is already claimed, so this never double-fires.
    const provider = resolveProvider(p.providerId);
    if (!provider) {
        await failClosed(p.providerId
            ? `AI provider "${p.providerId}" is not installed or enabled`
            : 'No active AI provider is installed');
        return;
    }

    // Resolve the owner principal for a prompt that records one. The run
    // executes on the owner's behalf, so a tool declaring
    // operatesOnUserOwnedObjects scopes to the owner instead of being denied.
    // Re-resolved live every fire — never a snapshot — so a revoked group or
    // a deleted account takes effect on the very next run. Fail closed: an
    // owner the resolver cannot resolve records a failed run rather than
    // executing under no/stale authority.
    let endUser: IToolEndUserPrincipal | undefined;
    if (p.ownerUserId) {
        // A throw here (transient DB error, identity service down) must fail
        // exactly like a null principal — record the failed run and return —
        // never escape to the caller, preserving per-run isolation.
        let principal: IToolEndUserPrincipal | null = null;
        try {
            principal = resolveEndUser ? await resolveEndUser(p.ownerUserId) : null;
        } catch (resolveErr) {
            logger.error(
                { err: resolveErr, promptId: p.id, name: p.name, ownerUserId: p.ownerUserId },
                'Saved-prompt owner resolution threw; failing closed'
            );
        }
        if (!principal) {
            await failClosed(`Prompt owner "${p.ownerUserId}" could not be resolved (account deleted, or identity service unavailable)`);
            return;
        }
        endUser = principal;
    }

    // Substitute per-run variables locally before the provider sees the text.
    // These values (e.g. a hook payload) exist only for this run, so they must
    // not pass through the shared prompt-variable registry; any registry
    // `{%name%}` tokens remaining after this substitution still expand
    // provider-side as usual.
    let promptText = p.prompt;
    if (opts.variables) {
        for (const [name, value] of Object.entries(opts.variables)) {
            promptText = promptText.split(`{%${name}%}`).join(value);
        }
    }

    // Identifiers for this run's Query-tab history record, captured before
    // the query so both the success and failure branches share them. Each
    // run gets its own conversationId because the History view only surfaces
    // records that carry one (a record without it is a hidden one-shot) — a
    // unique id makes the autonomous turn a reopenable one-turn conversation.
    const queryStartedAt = new Date().toISOString();
    const historyId = randomUUID();
    const historyConversationId = randomUUID();

    try {
        logger.info(
            { promptId: p.id, name: p.name, triggerId, providerId: p.providerId, model: p.model, ownerUserId: p.ownerUserId },
            'Running saved prompt'
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
                    'Failed to compose injected system prompt for autonomous run; proceeding without it'
                );
            }
        }
        // Autonomous run → programmatic mode. The provider derives
        // triggerPath: 'programmatic' / actor: system from this, so the
        // governor's external-tool default-deny applies (no human present).
        // `endUser`, when the prompt records an owner, is the live principal
        // the run acts on behalf of. `model` is the optional per-query
        // override (undefined → provider's configured default).
        // `toolAllowlist` is the prompt's least-privilege selector (undefined
        // → all enabled tools, `[]` → none, a name list → that subset); a
        // listed name that resolves to no registered tool fails the run,
        // which the catch below records and counts toward the auto-pause.
        // Thread this run's conversationId into the query so the governor stamps
        // every tool audit record with the same id the history record carries.
        // Without it the audit rows are untagged and the Query tab's
        // per-conversation tool lookup (listActivity({ conversationId })) finds
        // nothing, surfacing a false "No tool calls in this conversation" on an
        // autonomous run that did use tools. Mode stays 'programmatic' — the id is
        // for audit correlation only and never relaxes the governor's autonomous
        // default-deny.
        const result = (await provider.query({ prompt: promptText, model: p.model, mode: 'programmatic', endUser, injectedSystemPrompt, toolAllowlist: p.toolAllowlist, conversationId: historyConversationId })) as IAiQueryResult;
        // Record the run in the core query history so it surfaces in the
        // Query tab beside interactive queries. Tagged `scheduled` to mark
        // it autonomous; the provider transport above stays `programmatic`,
        // so this label never relaxes the governor's default-deny. Wrapped
        // best-effort: a history fault must not fail an otherwise-good run.
        if (recordQuery) {
            try {
                await recordQuery(
                    buildAiQueryRecord('scheduled', promptText, historyConversationId, queryStartedAt, historyId, result, null, p.model)
                );
            } catch (historyErr) {
                logger.warn(
                    { err: historyErr, promptId: p.id, name: p.name },
                    'Failed to record saved-prompt query history'
                );
            }
        }
        // Success ends the trigger's failure streak so intermittent errors
        // never accumulate toward the auto-pause threshold. Best-effort. A
        // manual run has no trigger streak, so there is nothing to reset.
        if (triggerId) {
            try {
                await savedPrompts.resetRunFailures(p.id, triggerId);
            } catch (writeErr) {
                logger.warn(
                    { err: writeErr, promptId: p.id, name: p.name },
                    'Failed to reset saved-prompt failure streak'
                );
            }
        }
        // Tell admins the run finished. Wrapped so a notifier fault cannot
        // disturb the caller or mask the successful query.
        try {
            notify?.({ promptId: p.id, name: p.name, status: 'success' });
        } catch (notifyErr) {
            logger.warn({ err: notifyErr, promptId: p.id }, 'Saved-prompt success notification failed');
        }
    } catch (err) {
        const lastRunError = err instanceof Error ? err.message : String(err);
        logger.error(
            { err, promptId: p.id, name: p.name, triggerId },
            'Saved prompt execution failed'
        );
        // Best-effort failure stamp; the run is already claimed, so a failure
        // here only loses the error banner, never duplicates. Consecutive
        // failures accumulate and eventually auto-pause the trigger so a
        // broken prompt stops refailing on every firing. A manual run has no
        // trigger to stamp, so it only records the failed run in history below.
        let autoDisabled = false;
        if (triggerId && claimedAt) {
            try {
                const { disabled } = await savedPrompts.recordRunFailure(p.id, triggerId, claimedAt, lastRunError);
                autoDisabled = disabled;
                if (disabled) {
                    logger.error(
                        { promptId: p.id, name: p.name, triggerId },
                        'Saved-prompt trigger auto-paused after consecutive failures'
                    );
                }
            } catch (writeErr) {
                logger.warn(
                    { err: writeErr, promptId: p.id, name: p.name },
                    'Failed to persist saved-prompt run error'
                );
            }
        }
        try {
            notify?.({ promptId: p.id, name: p.name, status: 'error', error: lastRunError, disabled: autoDisabled });
        } catch (notifyErr) {
            logger.warn({ err: notifyErr, promptId: p.id }, 'Saved-prompt failure notification failed');
        }
        // Record the failed run too, so a broken autonomous prompt is visible
        // in the Query tab with its error rather than only on its trigger
        // banner. Best-effort, mirroring the success branch.
        if (recordQuery) {
            try {
                await recordQuery(
                    buildAiQueryRecord('scheduled', promptText, historyConversationId, queryStartedAt, historyId, null, lastRunError, p.model)
                );
            } catch (historyErr) {
                logger.warn(
                    { err: historyErr, promptId: p.id, name: p.name },
                    'Failed to record failed saved-prompt query history'
                );
            }
        }
    }
}
