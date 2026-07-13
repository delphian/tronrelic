/**
 * @file ISavedPrompt.ts
 *
 * Shared type for a saved prompt template owned by the core AI Tools module.
 *
 * Saved prompts are durable, provider-independent user assets: a named prompt
 * body, optionally carrying one or more triggers that fire it autonomously —
 * a cron schedule evaluated on the core scheduler tick, or a binding to a
 * declared core hook seam (e.g. `content.published`) that enqueues a run when
 * the hook fires. They outlive any single provider plugin — disabling or
 * swapping the transport never orphans them. Stored in the core
 * `module_ai-tools_prompts` collection and consumed by both the backend
 * service and the `/system/ai-tools` Query tab, so the type is platform-owned
 * rather than plugin-owned.
 */

/**
 * Run bookkeeping every trigger element carries, scoped to that element so two
 * triggers on one prompt never clobber each other's streaks or timestamps.
 * Written by the runner/worker via field-level array-filtered updates.
 */
export interface ISavedPromptTriggerBase {
    /**
     * Stable identifier for this trigger element, generated server-side on
     * creation and preserved across editor saves. The runner and the queue
     * worker address their bookkeeping writes (`lastRunAt`, `failureCount`) to
     * this id, so an edit that reorders or rewrites sibling triggers never
     * misattributes a run.
     */
    id: string;
    /**
     * Whether this trigger fires. `false` pauses the element without losing its
     * configuration — the auto-pause after consecutive failures flips this off.
     */
    enabled: boolean;
    /** ISO timestamp of this trigger's last execution attempt. */
    lastRunAt?: string;
    /** Error message from this trigger's most recent run, or null on success. */
    lastRunError?: string | null;
    /**
     * Count of this trigger's consecutive failed runs. Reset to 0 on any
     * successful run. When it reaches the auto-disable threshold the trigger is
     * paused (`enabled: false`) so a systematically broken prompt stops
     * refailing; the admin re-enables after fixing the cause.
     */
    failureCount?: number;
}

/**
 * A cron trigger — the prompt fires on the core scheduler tick whenever the
 * expression has elapsed since this trigger's last run. The run is autonomous
 * (`programmatic`/`system`), so the governor's external-tool default-deny
 * applies — no human is present to catch a mistake.
 */
export interface ISavedPromptCronTrigger extends ISavedPromptTriggerBase {
    kind: 'cron';
    /**
     * Cron expression validated by the backend via `cron-parser`. Standard
     * 5-field syntax is supported; 6-field expressions with a leading seconds
     * field are also accepted. Evaluated in UTC.
     */
    cron: string;
    /**
     * ISO timestamp from which the runner computes the next cron occurrence,
     * set whenever the cron value is added or rewritten. Kept separate from
     * `lastRunAt` so a schedule edit re-anchors the cadence to "now" (matching
     * the editor's "Next run" preview, never firing an old prompt
     * retroactively) without falsely reporting that the prompt just ran. The
     * runner anchors on the latest of `lastRunAt`, `anchorAt`, and the
     * prompt's `createdAt`.
     */
    anchorAt?: string;
}

/**
 * A hook trigger — the prompt is bound to a declared core hook seam (an
 * observer descriptor id such as `content.published`). When the hook fires,
 * the ai-tools module enqueues a run on a durable queue — never inline, since
 * the hook fires in-process during another pipeline's commit — and the worker
 * executes the prompt with the hook payload exposed as `{%hook.*%}` variables.
 * Hook runs are autonomous, so the same governor default-deny applies.
 */
export interface ISavedPromptHookTrigger extends ISavedPromptTriggerBase {
    kind: 'hook';
    /**
     * The declared hook descriptor id this trigger binds to. Only ids declared
     * in the central hook registry are accepted at save time, so a prompt can
     * never bind to a seam that does not exist.
     */
    hookId: string;
    /**
     * Optional content-type filter for content-lifecycle hooks: when set, the
     * trigger fires only when the hook payload's `typeId` equals this value
     * (e.g. `blog:post`), so a prompt reacting to blog publishes ignores every
     * other published type. Absent means the trigger fires on every event.
     */
    typeIdFilter?: string;
}

/**
 * One autonomous firing rule on a saved prompt — a cron schedule or a hook
 * binding. A prompt carries any number of triggers; each element keeps its own
 * run bookkeeping.
 */
export type ISavedPromptTrigger = ISavedPromptCronTrigger | ISavedPromptHookTrigger;

/** A named prompt template that can be loaded into the query composer. */
export interface ISavedPrompt {
    /** Unique identifier generated on creation. */
    id: string;
    /** Human-readable name for this prompt. */
    name: string;
    /** The prompt text, potentially including {%variable%} patterns. */
    prompt: string;
    /**
     * Optional AI provider this prompt targets, by provider plugin id (e.g.
     * `'ai-assistant'`). When set, an autonomous run executes against this
     * specific provider — resolved from the core `'ai-providers'` registry by id
     * — rather than whatever provider is active at run time, so a prompt pinned
     * to a model keeps running on that model's provider even after the active
     * transport changes. Absent means "use the active provider". Models can span
     * multiple providers, so the provider must be recorded alongside the model.
     */
    providerId?: string;
    /**
     * Optional model id this prompt runs on, passed to the provider as the
     * per-query model override. Belongs to `providerId`'s catalog (the editor's
     * picker lists models grouped by provider). Absent means the provider's
     * configured default model.
     */
    model?: string;
    /**
     * Per-prompt tool allowlist — the least-privilege selector an autonomous run
     * passes to the provider as {@link IAiQueryOptions.toolAllowlist}. Three-state:
     * `undefined` runs against every enabled tool (the only meaning an absent
     * field can carry for prompts saved before this field existed); `[]` runs with
     * no tools; a non-empty list restricts to exactly those names, intersected
     * with the enabled and autonomous-allowed sets at fire time. A listed name
     * that resolves to no registered tool fails the run (recorded on the firing
     * trigger's `lastRunError`, counted toward its `failureCount`), so a prompt
     * naming a tool from a disabled plugin auto-pauses rather than running
     * degraded. The new-prompt editor pre-fills the full enabled set; narrowing
     * is the operator's choice.
     */
    toolAllowlist?: string[];
    /**
     * Better Auth user id of the prompt's owner — the admin who saved it today,
     * an end user once a non-admin authoring path exists. An autonomous run
     * re-resolves this id to a live end-user principal at fire time and runs the
     * prompt on that user's behalf (the governor sees it as `endUser`), so a tool
     * declaring `operatesOnUserOwnedObjects` scopes to the owner rather than
     * being denied. Absent on prompts saved before ownership existed: those run
     * with no principal, exactly as an unattended system query does.
     */
    ownerUserId?: string;
    /**
     * Denormalized owner label (email or name) captured at save time for the
     * admin list view, so rendering the owner needs no per-row account lookup.
     * Display-only and best-effort — it can go stale if the account's email
     * changes; `ownerUserId` is the authoritative key and is always re-resolved
     * fresh at fire time.
     */
    ownerLabel?: string;
    /** ISO timestamp of when the prompt was saved. */
    createdAt: string;
    /** ISO timestamp of last update. */
    updatedAt: string;
    /**
     * The prompt's autonomous firing rules — cron schedules and hook bindings,
     * each with its own enabled flag and run bookkeeping. Absent or empty means
     * the prompt only runs when loaded into the composer by hand. Replaces the
     * pre-6.4 flat `cron`/`scheduleEnabled` fields (migration
     * `module:ai-tools:001_saved_prompt_triggers` folds a legacy cron into one
     * element here).
     */
    triggers?: ISavedPromptTrigger[];
    /**
     * @deprecated Transitional read-only projection of the first cron trigger's
     * expression, derived by the backend at read time (never stored). Exists so
     * the pre-`triggers[]` editor UI keeps compiling and working until the
     * chunk-3b editor lands; write via `triggers`, not this field.
     */
    cron?: string | null;
    /**
     * @deprecated Transitional projection of the first cron trigger's `enabled`
     * flag. See {@link ISavedPrompt.cron}.
     */
    scheduleEnabled?: boolean;
    /**
     * @deprecated Transitional projection of the first cron trigger's
     * `lastRunAt`. See {@link ISavedPrompt.cron}.
     */
    lastRunAt?: string;
    /**
     * @deprecated Transitional projection of the first cron trigger's
     * `lastRunError`. See {@link ISavedPrompt.cron}.
     */
    lastRunError?: string | null;
}
