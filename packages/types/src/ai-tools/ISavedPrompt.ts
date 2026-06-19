/**
 * @file ISavedPrompt.ts
 *
 * Shared type for a saved prompt template owned by the core AI Tools module.
 *
 * Saved prompts are durable, provider-independent user assets: a named prompt
 * body, optionally carrying a cron schedule that fires it autonomously on the
 * core scheduler tick through whichever AI provider is currently active. They
 * outlive any single provider plugin — disabling or swapping the transport
 * never orphans them. Stored in the core `module_ai-tools_prompts` collection
 * and consumed by both the backend service and the `/system/ai-tools` Query
 * tab, so the type is platform-owned rather than plugin-owned.
 */

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
     * `'ai-assistant'`). When set, a scheduled run executes against this specific
     * provider — resolved from the core `'ai-providers'` registry by id — rather
     * than whatever provider is active at run time, so a prompt pinned to a
     * model keeps running on that model's provider even after the active
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
    /** ISO timestamp of when the prompt was saved. */
    createdAt: string;
    /** ISO timestamp of last update. */
    updatedAt: string;
    /**
     * Optional cron expression validated by the backend via `cron-parser`.
     * Standard 5-field syntax is supported, and 6-field expressions with a
     * leading seconds field are also accepted. When set, the prompt runs on the
     * core scheduler tick whenever the cron has fired since the last execution.
     * The run executes against the active AI provider as an autonomous
     * (`programmatic`/`system`) query, so the governor's external-tool
     * default-deny applies — no human is present to catch a mistake.
     *
     * Tri-state: a string is an active cron, `null` is an explicit clear
     * persisted to the DB (so the document records that there was once a
     * schedule and the admin removed it), and absence/`undefined` means the
     * field was never set. The null vs undefined distinction matters at the
     * write site — the Mongo Node driver strips `undefined` from `$set`
     * payloads by default, which would silently leave the prior value in place.
     */
    cron?: string | null;
    /**
     * Opt-out switch for a configured cron. Absent or `true` means the schedule
     * is active; `false` pauses the schedule without losing the cron string.
     */
    scheduleEnabled?: boolean;
    /** ISO timestamp of the last scheduled execution attempt. */
    lastRunAt?: string;
    /**
     * ISO timestamp from which the runner computes the next cron occurrence,
     * set whenever the cron value is added or rewritten. Kept separate from
     * `lastRunAt` so a schedule edit re-anchors the cadence to "now" (matching
     * the editor's "Next run" preview, never firing an old prompt retroactively)
     * without falsely reporting that the prompt just ran. The runner anchors on
     * the latest of `lastRunAt`, `scheduleAnchorAt`, and `createdAt`.
     */
    scheduleAnchorAt?: string;
    /** Error message from the most recent scheduled run, or null on success. */
    lastRunError?: string | null;
    /**
     * Count of consecutive failed scheduled runs. Reset to 0 on any successful
     * run. When it reaches the runner's auto-disable threshold the schedule is
     * paused (`scheduleEnabled: false`) so a systematically broken prompt stops
     * refailing every tick; the admin re-enables after fixing the cause.
     */
    failureCount?: number;
}
